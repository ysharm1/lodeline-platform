import { NextResponse } from "next/server";
import { isDomainError } from "@/domain/errors";

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(data, { status, headers });
}

/** Maps domain errors to the shared error shape; everything else is a 500 with no detail. */
export function errorResponse(e: unknown) {
  if (isDomainError(e)) {
    return json({ error: { code: e.code, message: e.message, field: e.field } }, e.httpStatus);
  }
  console.error("[api] unhandled error", (e as Error)?.name ?? "Error");
  return json({ error: { code: "INTERNAL", message: "Something went wrong." } }, 500);
}
