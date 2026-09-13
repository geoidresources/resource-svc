import BucketBrowser from "@/components/BucketBrowser";
import Gate from "@/components/Gate";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { hasSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const REQUIRED = [
  "GCP_EMAIL",
  "GCP_PRIVATE_KEY",
  "GCP_PROJECT_ID",
  "GCP_BUCKET",
  "SESSION_SECRET",
  "UPLOAD_ACCESS_CODE",
];

export default async function Page() {
  const missing = REQUIRED.filter((k) => !process.env[k]);

  if (missing.length > 0) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <Alert variant="destructive">
          <AlertTitle>Missing environment variables</AlertTitle>
          <AlertDescription>
            <code>{missing.join(", ")}</code> — set these in <code>.env.local</code> or the
            Vercel project settings.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!(await hasSession())) return <Gate />;

  return (
    <BucketBrowser
      root={(process.env.UPLOAD_ROOT_PREFIX || "uploads").replace(/^\/+|\/+$/g, "")}
    />
  );
}
