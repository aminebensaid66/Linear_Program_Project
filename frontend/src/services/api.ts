import axios from "axios";
import type { LpResponse } from "../types/lp";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 90_000,
  headers: {
    "Content-Type": "application/json"
  }
});

export async function solveLp(problem: string): Promise<LpResponse> {
  const response = await api.post<LpResponse>("/lp/solve", { problem });
  return response.data;
}

export async function checkHealth(): Promise<boolean> {
  try {
    await api.get("/lp/health");
    return true;
  } catch {
    return false;
  }
}