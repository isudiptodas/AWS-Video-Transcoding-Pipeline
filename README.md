
# AWS Video Transcoding Pipeline
## Prerequisites
- AWS account
- Basic knowledge of docker, ECS & ECR, S3, SQS

One of the most famous and widely used platforms is youtube. And back in time when I was a kid, I used to believe that okay, I click on a button, select a video and click on upload. That's it. That is the only thing youtube does. And makes a lot of money. Yeah, but later when I was introduced to cloud computing and system design, I got to know that, okay, these are the things that are involved in the backend. And it is not an easy task to handle.
Recently I came to know about a term called video transcoding or video transcoding process which is one of the core pillar of youtube platform.
Now the term video transcoding sounds very cool and technically very much appealing, but what is the actual meaning behind it? What do you mean by transcoding a video?

## What is video transcoding ?
Transcoding a video means converting the video into multiple small sizes, resolutions and formats so that it can play on any device, and on any internet speed.

## Why video transcoding needed ?
Suppose you are making a video streaming platform and there you've given option to upload a video. Now user may upload a video and that video size may go from 500MB, 1GB upto 7GB or even though suppose the video is of a 4K quality. Now initially suppose you have 10,000 users and whenever those 10,000 users want to play that video they have to first download the entire video, which may be of several MB or GB and doesn't matter what is the internet speed of specific users or what is the bandwidth, but still they have to download the entire video and have to play the exact resolution. They don't have any option to switch between lower or higher quality based on the network speed which will result of buffering, slow streaming or even at scale crash, and this will ruin your user experience.

Now think of the same situation but this time you have implemented a video transcoding pipeline in between, so now whenever a user uploads a video, you are not saving the entire raw video directly, instead, first you are getting the video on your side then you are running a pipeline where that video gets processed to multiple formats for example, 240p, 360p, 480p, 720p and so on. And now you are saving those processed formats in your objects object storage along with the original file as well. So whenever a user will play that video, they will get multiple quality options to switch on. And by applying this technique, your users will get a seamless experience no matter on which device they are playing the video or how fast the internet is. 

## Architecture

![diagram](https://ik.imagekit.io/isudiptodas/portfolio-article-images/aws-video-transcoding/video-transcoding-diagram.png)

1. User will upload a video
2. That video will be uploaded to an S3 bucket (input bucket)
3. After any upload S3 will send an event notification to SQS
4. Our code will be containerized and will be deployed on AWS ECS fargate
5. Our code will constantly poll SQS for new messages 
6. When a new event notification will be available it will first collect the event data & will download the raw video from S3
7. The video will be stored temporarily in the `/tmp` location inside the container
8. FFmpeg will start transcoding into multiple formats and save them in the `/tmp` location
9. After that all the saved formats will be uploaded in a new S3 bucked (output bucket)
10. The particular event notification for that video will be deleted from the SQS queue 
11. At the end, the `/tmp`  location files will be deleted

Now here you may have seen the term **FFmpeg** and you may think that what is this alien kind of name? And maybe a lot of people are hearding the name for the first time so let me tell you in today's modern world whichever platforms exist, for video processing, either cropping, resizing, compressing, editing, any kind of video processing work, it is a high chance that behind the scene they using **FFmpeg** because **FFmpeg** is one of the strongest tool or even you can say a backbone for processing video files.

## Resources to create on AWS
1. S3 bucket (x2)
2. SQS queue
3. ECR for uploading docker images
4. ECS for running image containers

## Required permissions

> NOTE: AWS can change permission structure in future so it is always recommended to look for policy JSON from official documentation.

### 1. SQS :
Your SQS queue needs to be allowed for S3 bucket to receive event notifications.
Below is an example for access policy JSON :
```yaml
{
  "Version": "2012-10-17",
  "Id": "AllowS3BucketToPublishEvents",
  "Statement": [
    {
      "Sid": "AllowS3EventNotifications",
      "Effect": "Allow",
      "Principal": {
        "Service": "s3.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:REGION:ACCOUNT_ID:QUEUE_NAME",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:s3:::YOUR_INPUT_BUCKET_NAME"
        },
        "StringEquals": {
          "aws:SourceAccount": "ACCOUNT_ID"
        }
      }
    }
  ]
}
```
### 2. ECS (Task Execution Role) :
Now a task execution role is a permission that is needed for your ecs containers from which they will need to have permissions like pulling images from ECR repositories, creating logs in cloudwatch and so on.
A basic example of tast execution role access policy JSON :
```yaml
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```
### 3. ECS (Task Role) :
Now it may sound confusing that previous one is a task execution role and right now is task role. So you can simply understand this in a way that you need task execution role for your ecs infrastructure management. Because your ECS containers will need permissions to pull images from your ECR, that's it. Very simple.

On the other hand, we're writing a code in our backend where we are polling the **SQS**. Downloading the raw video from **S3**, then transcoding it and then again uploading the multiple formats in a different S3 bucket and deleting the sqs message for that particular event. Now to make all this happen inside our code, we need to communicate with different AWS services and task role defines that only that. It gives application level permission that AWS services our code can communicate with.

## Implementation :
### ECR :
1. Create a ECR repo to store images
![ecr](https://ik.imagekit.io/isudiptodas/portfolio-article-images/aws-video-transcoding/ecr-repository.png)
2. Click on **View push commands** for instructions and pushing the docker image (code) to ECR
![ecr-before](https://ik.imagekit.io/isudiptodas/portfolio-article-images/aws-video-transcoding/ecr-before-push.png)
3. After pushing the image it will be shown in this way
![ecr-after](https://ik.imagekit.io/isudiptodas/portfolio-article-images/aws-video-transcoding/ecr-after-push.png)
### ECS :
1. Create a cluster for ECS
![ecs-cluster](https://ik.imagekit.io/isudiptodas/portfolio-article-images/aws-video-transcoding/ecs-cluster.png)
2. Create a new task definition first with details like : task family, image URI, container name, task size, launch machine type, port mappings, environment variables etc.
3. Create a new service with the task definition
![ecs-service](https://ik.imagekit.io/isudiptodas/portfolio-article-images/aws-video-transcoding/ecs-service-create.png)

### SQS Queue :
1. Create a queue for receiving event notifications
![sqs-queue](https://ik.imagekit.io/isudiptodas/portfolio-article-images/aws-video-transcoding/sqs-queue.png)

### S3 :
1. Create two s3 buckets, one for input and one for output
![s3-buckets](https://ik.imagekit.io/isudiptodas/portfolio-article-images/aws-video-transcoding/s3-buckets.png)
2. Go to S3 input bucket > properties > scroll down & you will see event notification 
3. Set up your event for any object creation and select your queue


## Code implementation :
```javascript
import "dotenv/config";
import express from 'express';
import Ffmpeg from 'fluent-ffmpeg';
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

const resolutions = [
  { label: "240p", width: 426, height: 240 },
  { label: "360p", width: 640, height: 360 },
  { label: "480p", width: 854, height: 480 },
  { label: "720p", width: 1280, height: 720 },
  { label: "1080p", width: 1920, height: 1080 },
];

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
```
Now I know a lot of thing is going on in this code so here's a short explanation :
1. First I am importing necessary packages and defining variables
2. Constantly polling to SQS for any event notifications
3. If notifications are present, fetch the event data from notification, get the video info
4. With the video info now I am downloading the raw video and saving in `/tmp` location
5. Then I am checking on which formats the video is available to be transcoded
6. Running the transcoding with FFmpeg and saving multiple formats in the same `/tmp` location
7. Finally uploading all the videos in the output bucket within a folder of the video name
8. Deleting the SQS event notification for the transcoded video
9. Deleting video files from `/tmp`
 
## Dockerfile
```bash
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
``` 
Now after running this code on ECS, you can test the pipeline by :
1. Upload a video in input bucket and check ECS container logs
![ecs-logs](https://ik.imagekit.io/isudiptodas/portfolio-article-images/aws-video-transcoding/ecs-logs-after.png)
2. And after sometime check in your output bucket for final video formats along with the original raw video
![ecs-logs](https://ik.imagekit.io/isudiptodas/portfolio-article-images/aws-video-transcoding/transcoding-output.png)

**Congratulations** 🎉
You just built a video transcoding pipeline from scratch and now you know what happens behind the scenes at any video platform after clicking on "Upload"

***
Thank you for reading ❤️

