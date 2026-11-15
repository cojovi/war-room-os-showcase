import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@agos/api/src/index";

export const trpc = createTRPCReact<AppRouter>();

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787/trpc";
