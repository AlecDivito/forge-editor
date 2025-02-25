import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3 } from "@aws-sdk/client-s3";

export class S3NotFound extends Error {}

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

export const DEFAULT_VERSION_NAME = "main";

const BUCKET_NAME = process.env.S3_BUCKET || "forge-editor";

export const saveFile = async (path: string, body: string, Metadata: Record<string, string> = {}) => {
  const Key = `${path}`;
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key,
    Body: body,
    Metadata,
  });
  await s3.send(command);
};

export const deleteFile = async (path: string) => {
  const Key = `${path}`;
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key,
  });
  await s3.send(command);
};

export const getFile = async (path: string): Promise<string | undefined> => {
  try {
    const Key = `${path}`;
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key,
    });

    const response = await s3.send(command);
    const content = await response.Body?.transformToString();
    return content;
  } catch (error) {
    return undefined;
  }
};

export const listFiles = async (prefix: string): Promise<string[]> => {
  const command = new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: prefix,
  });

  const response = await s3.send(command);
  return response.Contents ? response.Contents.map((obj) => obj.Key!) : [];
};
