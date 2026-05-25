"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIDEStore } from "@/store/useIDEStore";

export default function SettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    useIDEStore.getState().setCurrentView("settings");
    router.replace("/");
  }, []);
  return null;
}
