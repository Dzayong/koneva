"use client";

import { useEffect } from "react";
import { track, type SiteEvent } from "@/lib/track";

export function TrackView({ event }: { event: SiteEvent }) {
  useEffect(() => { track(event); }, [event]);
  return null;
}
