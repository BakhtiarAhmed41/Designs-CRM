import { apiFetch } from "./api";

export type UserRole = "CLIENT" | "ADMIN";

export type User = {
  id: string;
  email: string;
  role: UserRole;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
};

export async function login(email: string, password: string) {
  return apiFetch<{ user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function register(email: string, password: string) {
  return apiFetch<{ user: User }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  return apiFetch<{ ok: true }>("/auth/logout", { method: "POST" });
}

export async function refresh() {
  return apiFetch<{ ok: boolean }>("/auth/refresh", { method: "POST" });
}

export async function getMe() {
  return apiFetch<{ user: User }>("/users/me");
}

export async function updateMe(data: Partial<Pick<User, "firstName" | "lastName" | "phone">>) {
  return apiFetch<{ user: User }>("/users/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

