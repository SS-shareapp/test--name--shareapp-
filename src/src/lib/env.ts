function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export const env = {
  r2AccountId: () => required("R2_ACCOUNT_ID"),
  r2AccessKeyId: () => required("R2_ACCESS_KEY_ID"),
  r2SecretAccessKey: () => required("R2_SECRET_ACCESS_KEY"),
  r2Bucket: () => required("R2_BUCKET"),
  neonUrl: () => required("NEON_DATABASE_URL")
};
