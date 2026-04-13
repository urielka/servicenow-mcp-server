import type { AuthProvider } from "./types.ts";

export class TokenAuthProvider implements AuthProvider {
  readonly name = "token";

  constructor(private readonly token: string) {}

  async getHeaders(): Promise<Record<string, string>> {
    return { "x-sn-apikey": this.token };
  }
}
