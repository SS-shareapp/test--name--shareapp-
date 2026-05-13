import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PRESIGN_EXPIRES_SECONDS } from "@/lib/constants";
import { env } from "@/lib/env";

function client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.r2AccountId()}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2AccessKeyId(),
      secretAccessKey: env.r2SecretAccessKey()
    }
  });
}

export function objectKey(fileId: string, idx: number): string {
  return `files/${fileId}/${idx}`;
}

export async function presignPut(key: string): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: env.r2Bucket(),
      Key: key,
      ContentType: "application/octet-stream"
    }),
    { expiresIn: PRESIGN_EXPIRES_SECONDS }
  );
}

export async function presignGet(key: string): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: env.r2Bucket(),
      Key: key
    }),
    { expiresIn: PRESIGN_EXPIRES_SECONDS }
  );
}
