// lib/redis.js
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379"); // Default to local Redis if no URL provided

export default redis;

export const getInodeReversions = async (path: string): Promise<string[]> => {
  const versions = await redis.smembers(`versions:${path}`);
  return versions;
};

export const saveInode = async (path: string, version: string) => {
  await redis.sadd(`versions:${path}`, version);
  await redis.hset(`file:${path}`, version);
};

export const deleteInode = async (path: string, version: string) => {
  await redis.srem(`versions:${path}`, version);
  await redis.hdel(`file:${path}`, version);
};
