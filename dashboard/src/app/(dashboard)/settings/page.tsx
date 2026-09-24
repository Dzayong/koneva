"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, Copy, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

function GapNotice({ endpoint }: { endpoint: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        Not available yet — api-gateway doesn&apos;t expose <code>{endpoint}</code>.
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const {
    data: tenant,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["tenant", "me"],
    queryFn: () => api.getMyTenant(),
    retry: false,
  });

  const [copied, setCopied] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");

  const handleCopy = async () => {
    if (!tenant?.api_key) return;
    await navigator.clipboard.writeText(tenant.api_key);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTestWebhook = () => {
    toast.info("Not available yet", {
      description: "There's no webhook test endpoint on the backend yet.",
    });
  };

  const quotaPercent = tenant
    ? Math.min(100, (tenant.used_messages / Math.max(1, tenant.quota_messages)) * 100)
    : 0;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Tenant, API key, and webhook configuration</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tenant Info</CardTitle>
          <CardDescription>Your account details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : isError || !tenant ? (
            <GapNotice endpoint="GET /api/v1/tenant" />
          ) : (
            <>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={tenant.name} readOnly />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={tenant.email ?? ""} readOnly />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API Key</CardTitle>
          <CardDescription>Used by this dashboard and any integration you build</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : isError || !tenant ? (
            <GapNotice endpoint="GET /api/v1/tenant" />
          ) : (
            <>
              <div className="flex gap-2">
                <Input value={tenant.api_key} readOnly type="password" className="font-mono" />
                <Button variant="outline" size="icon" onClick={handleCopy}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  toast.info("Not available yet", {
                    description: "There's no key rotation endpoint on the backend yet.",
                  })
                }
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Regenerate
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook URL</CardTitle>
          <CardDescription>
            Receives message.sent / delivered / read / failed events, HMAC-signed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="https://your-app.com/webhooks/wa-gateway"
              value={webhookUrl || tenant?.webhook_url || ""}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
            <Button variant="outline" onClick={handleTestWebhook}>
              <Send className="mr-2 h-4 w-4" />
              Test
            </Button>
          </div>
          {(isError || !tenant) && !isLoading && <GapNotice endpoint="PATCH /api/v1/tenant" />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quota Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <Skeleton className="h-4 w-full" />
          ) : isError || !tenant ? (
            <GapNotice endpoint="GET /api/v1/tenant" />
          ) : (
            <>
              <Progress value={quotaPercent} />
              <p className="text-sm text-muted-foreground">
                {tenant.used_messages.toLocaleString()} / {tenant.quota_messages.toLocaleString()}{" "}
                messages used this period
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team Management</CardTitle>
          <CardDescription>Invite members, assign roles</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Not buildable yet — the schema has one <code>api_key</code> per tenant, no{" "}
              <code>users</code>/<code>team_members</code> table or per-user roles at all. This
              needs real backend work (auth model, RBAC), not just a UI.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
          <CardDescription>Plan, invoices, payment method</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Not buildable yet — no billing provider (Stripe/Xendit) is integrated, and{" "}
              <code>tenants</code> has no plan/pricing-tier columns. See{" "}
              <code>docs/PROJECT_VISION.md</code> &quot;Business Features&quot;.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
