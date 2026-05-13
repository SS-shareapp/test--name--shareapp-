function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export const env = {
  cloudflareAccountId: () => required("CLOUDFLARE_ACCOUNT_ID"),
  d1DatabaseId: () => required("CLOUDFLARE_D1_DATABASE_ID"),
  d1ApiToken: () => required("CLOUDFLARE_D1_API_TOKEN"),
  r2AccountId: () => required("R2_ACCOUNT_ID"),
  r2AccessKeyId: () => required("R2_ACCESS_KEY_ID"),
  r2SecretAccessKey: () => required("R2_SECRET_ACCESS_KEY"),
  r2Bucket: () => required("R2_BUCKET")
};
