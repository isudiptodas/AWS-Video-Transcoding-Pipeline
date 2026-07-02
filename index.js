import "dotenv/config";

import express from 'express';
import Ffmpeg from 'fluent-ffmpeg';
import { resolutions } from './data/resolutions.js';
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import fs from "fs";
import path from "path";
import os from "os";
import { pipeline } from "stream/promises";

Ffmpeg.setFfmpegPath(ffmpegPath);
Ffmpeg.setFfprobePath(ffprobe.path);
const app = express();

const s3 = new S3Client({
    region: 'ap-south-1'
});

const sqs = new SQSClient({
    region: 'ap-south-1'
});

app.use('/', (req, res) => {
    return res.status(200).json({
        message: `All good`
    });
});

app.use('/health', (req, res) => {
    return res.status(200).json({
        health: `OK`,
        server: `Running...`
    });
});

// get video resolution
function getVideoResolution(videoPath) {
    return new Promise((resolve, reject) => {
        Ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                return reject(err);
            }

            const videoStream = metadata.streams.find(
                stream => stream.codec_type === "video"
            );

            resolve({
                width: videoStream.width,
                height: videoStream.height
            });
        });
    });
}

// poll for queue messages
async function pollQueue() {
    try {
        const response = await sqs.send(
            new ReceiveMessageCommand({
                QueueUrl: process.env.QUEUE_URL,
                MaxNumberOfMessages: 1,
                WaitTimeSeconds: 20
            })
        );

        if (!response.Messages) {
            console.log("No messages.");
            return;
        }

        const message = response.Messages[0];
        const body = JSON.parse(message.Body);
        const record = body.Records[0];
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key);

        if (bucket !== process.env.INPUT_BUCKET) {
            console.log("Ignoring another bucket.");
            return null;
        }

        return {
            bucket,
            key,
            receiptHandle: message.ReceiptHandle
        };
    }
    catch (error) {
        console.log(`Polling error -> ${error}`);
    }
}

// downloading & processing video from s3
async function processVideo(job) {

    const generatedFiles = [];

    try {
        const folderName = path.parse(job.key).name;
        const inputPath = path.join(os.tmpdir(), job.key);

        const response = await s3.send(
            new GetObjectCommand({
                Bucket: job.bucket,
                Key: job.key
            })
        );

        await pipeline(
            response.Body,
            fs.createWriteStream(inputPath)
        );

        console.log("Download completed.");

        const video = await getVideoResolution(inputPath);

        const supportedResolutions = resolutions.filter(resolution =>
            resolution.width <= video.width &&
            resolution.height <= video.height
        );

        for (const resolution of supportedResolutions) {

            const outputPath = path.join(
                os.tmpdir(),
                `${resolution.label}.mp4`
            );

            await transcodeVideo(
                inputPath,
                outputPath,
                resolution.height
            );

            generatedFiles.push(outputPath);

        }

        generatedFiles.unshift(inputPath);

        for (const file of generatedFiles) {
            const fileName = path.basename(file);
            await s3.send(
                new PutObjectCommand({
                    Bucket: process.env.OUTPUT_BUCKET,
                    Key: `${folderName}/${fileName}`,
                    Body: fs.createReadStream(file),
                    ContentType: "video/mp4"
                })
            );

            console.log(`${fileName} uploaded`);
        }

        for (const file of generatedFiles) {
            await fs.promises.unlink(file);
        }

        await sqs.send(
            new DeleteMessageCommand({
                QueueUrl: process.env.QUEUE_URL,
                ReceiptHandle: job.receiptHandle
            })
        );

        console.log("Video transcoded & uploaded");

    } catch (error) {
        console.log(`Video processing error -> ${error}`);
    }
}

// transcode video in multiple formats
function transcodeVideo(inputPath, outputPath, height) {
    return new Promise((resolve, reject) => {
        Ffmpeg(inputPath)
            .videoFilters(`scale=-2:${height}`)
            .on("end", () => {
                console.log(`${height}p completed`);
                resolve();
            })
            .on("error", (err) => {
                reject(err);
            })
            .save(outputPath);
    });
}

// polling worker
async function worker() {

    while (true) {
        const job = await pollQueue();
        if (!job) {
            continue;
        }
        await processVideo(job);
    }
}

worker();
