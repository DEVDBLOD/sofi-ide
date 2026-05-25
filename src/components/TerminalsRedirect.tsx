"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIDEStore } from "@/store/useIDEStore";

export default function TerminalsRedirect() {
  const router = useRouter();
  useEffect(() => {
    useIDEStore.getState().setCurrentView("terminals");
    router.replace("/");
  }, []);
  return null;
}
