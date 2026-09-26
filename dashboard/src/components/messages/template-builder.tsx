"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractSpintaxVariables, renderSpintax } from "@/lib/spintax";

const PREVIEW_SAMPLE_COUNT = 3;

export function TemplateBuilder({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [previewSeed, setPreviewSeed] = useState(0);
  const [sampleName, setSampleName] = useState("Budi");

  const variables = useMemo(() => extractSpintaxVariables(value), [value]);

  const previews = useMemo(() => {
    if (!value.trim()) return [];
    const vars = { nama: sampleName, name: sampleName };
    return Array.from({ length: PREVIEW_SAMPLE_COUNT }, () => renderSpintax(value, vars));
    // previewSeed forces re-render with fresh random picks on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, sampleName, previewSeed]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="template">Templat pesan</Label>
        <textarea
          id="template"
          className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="{Halo|Hi|Hey} {nama}, ada promo spesial buat kamu hari ini!"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Spintax: <code>{"{option1|option2|option3}"}</code> memilih satu secara acak setiap kali kirim.
          Variabel seperti <code>{"{nama}"}</code> diisi sesuai penerima saat dikirim.
        </p>
      </div>

      {variables.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="sampleName">Nilai contoh untuk {"{nama}"}</Label>
          <Input id="sampleName" value={sampleName} onChange={(e) => setSampleName(e.target.value)} />
        </div>
      )}

      {previews.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Pratinjau ({PREVIEW_SAMPLE_COUNT} contoh acak)</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setPreviewSeed((s) => s + 1)}>
              <RefreshCw className="mr-2 h-3 w-3" />
              Acak ulang
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {previews.map((preview, i) => (
              <p key={i} className="rounded-md bg-muted p-2 text-sm">
                {preview}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
