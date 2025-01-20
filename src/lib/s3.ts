import { S3 } from "@aws-sdk/client-s3";

export const s3 = new S3({
  region: "garage", // Replace with your region
  bucketEndpoint: false,
  disableHostPrefix: true,
  forcePathStyle: true,
  endpoint: {
    hostname: "s3.alecdivito.com",
    protocol: "https:",
    path: "/",
  },
  logger: {
    trace: (...content) => console.log(JSON.stringify(content)),
    debug: (...content) => console.log(JSON.stringify(content)),
    info: (...content) => console.log(JSON.stringify(content)),
    warn: (...content) => console.log(JSON.stringify(content)),
    error: (...content) => console.log(JSON.stringify(content)),
  },
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
