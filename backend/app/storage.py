from __future__ import annotations

from dataclasses import dataclass

import boto3

from .config import settings


@dataclass(frozen=True)
class PresignedPart:
    idx: int
    url: str


def _client():
    if not settings.s3_endpoint_url:
        raise RuntimeError("S3_ENDPOINT_URL is not set")
    if not settings.s3_access_key_id or not settings.s3_secret_access_key:
        raise RuntimeError("S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not set")
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        region_name=settings.s3_region,
    )


def presign_put_object(*, key: str, content_type: str = "application/octet-stream") -> str:
    if not settings.s3_bucket:
        raise RuntimeError("S3_BUCKET is not set")
    c = _client()
    return c.generate_presigned_url(
        ClientMethod="put_object",
        Params={"Bucket": settings.s3_bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=settings.presign_expires_seconds,
    )


def presign_get_object(*, key: str) -> str:
    if not settings.s3_bucket:
        raise RuntimeError("S3_BUCKET is not set")
    c = _client()
    return c.generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=settings.presign_expires_seconds,
    )

