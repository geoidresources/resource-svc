import { Storage } from "@google-cloud/storage";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export const BUCKET = process.env.GCP_BUCKET || "geoidresources";
export const ROOT_PREFIX = (process.env.UPLOAD_ROOT_PREFIX || "uploads").replace(/^\/+|\/+$/g, "");

let client: Storage | null = null;

export function storage(): Storage {
  if (client) return client;
  client = new Storage({
    projectId: env("GCP_PROJECT_ID"),
    credentials: {
      client_email: env("GCP_EMAIL"),
      private_key: env("GCP_PRIVATE_KEY").replace(/\\n/g, "\n"),
    },
  });
  return client;
}

export type ResumableGrant = {
  url: string;
  headers: Record<string, string>;
};

export async function signResumableInit(
  key: string,
  contentType: string,
  ttlMinutes: number,
): Promise<ResumableGrant> {
  const [url] = await storage()
    .bucket(BUCKET)
    .file(key)
    .getSignedUrl({
      version: "v4",
      action: "resumable",
      expires: Date.now() + ttlMinutes * 60_000,
      contentType,
    });
  return {
    url,
    headers: { "x-goog-resumable": "start", "content-type": contentType },
  };
}
