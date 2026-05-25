"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIDEStore } from "@/store/useIDEStore";

export default function PreviewRedirect() {
  const router = useRouter();
  useEffect(() => {
    useIDEStore.getState().setCurrentView("preview");
    router.replace("/");
  }, []);
  return null;
}
