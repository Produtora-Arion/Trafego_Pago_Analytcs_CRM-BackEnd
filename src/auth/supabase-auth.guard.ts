import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';

export interface AuthUser {
  id: string | null;
  email: string | null;
  role: 'admin' | 'client';
  customerId: string | null;
}

/**
 * Valida a sessão Supabase (Authorization: Bearer <token>) e aplica
 * o isolamento por cliente: usuários com role 'client' só acessam
 * dados do próprio customerId — em query, params e body.
 *
 * Também aceita x-api-key (chave de servidor) como acesso admin,
 * para scripts e integrações servidor-a-servidor.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private client: SupabaseClient;
  private cache = new Map<string, { user: User; exp: number }>();

  constructor(private readonly config: ConfigService) {
    this.client = createClient(
      this.config.getOrThrow('SUPABASE_URL'),
      this.config.getOrThrow('SUPABASE_SECRET_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // 1) Acesso servidor-a-servidor via API key (equivale a admin)
    const apiKey = req.headers['x-api-key'];
    const validKey = this.config.get('API_KEY');
    if (typeof apiKey === 'string' && validKey && this.safeCompare(apiKey, validKey)) {
      req.user = { id: null, email: null, role: 'admin', customerId: null } as AuthUser;
      return true;
    }

    // 2) Sessão Supabase
    const authHeader = req.headers['authorization'] as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Faça login para continuar');
    }
    const token = authHeader.slice(7);

    const user = await this.resolveUser(token);
    const role = user.app_metadata?.role === 'admin' ? 'admin' : 'client';
    const customerId: string | null = user.app_metadata?.customer_id ?? null;

    req.user = { id: user.id, email: user.email ?? null, role, customerId } as AuthUser;

    // 3) Isolamento: client só acessa o próprio customerId.
    // IMPORTANTE: isto só REJEITA um customerId explícito e divergente — nunca
    // tenta "preencher" um customerId ausente aqui. No Express 5, req.query é
    // um getter recalculado a partir da URL a cada leitura; escrever nele
    // (req.query.customerId = ...) não persiste, então qualquer controller que
    // dependesse disso pra filtrar ficava, na prática, SEM filtro nenhum quando
    // o client omitia o parâmetro — vazando dados de outros clientes. Por isso
    // cada controller resolve o customerId efetivo explicitamente (via um
    // helper tenant(req) que lê req.user.customerId, sempre confiável) em vez
    // de confiar em qualquer auto-preenchimento por aqui.
    if (role !== 'admin') {
      if (!customerId) {
        throw new ForbiddenException('Usuário sem cliente vinculado — contate o administrador');
      }
      const requested =
        req.params?.customerId ?? req.query?.customerId ?? req.body?.customerId;
      if (requested && String(requested) !== String(customerId)) {
        throw new ForbiddenException('Acesso negado aos dados de outro cliente');
      }
    }

    return true;
  }

  /** Compara em tempo constante — evita vazar a x-api-key por diferença de timing. */
  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }

  /** Valida o token no Supabase com cache de 60s para não pesar as requisições */
  private async resolveUser(token: string): Promise<User> {
    const cached = this.cache.get(token);
    if (cached && cached.exp > Date.now()) return cached.user;

    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data?.user) {
      throw new UnauthorizedException('Sessão inválida ou expirada — faça login novamente');
    }

    this.cache.set(token, { user: data.user, exp: Date.now() + 60_000 });
    if (this.cache.size > 500) {
      const now = Date.now();
      for (const [k, v] of this.cache) if (v.exp < now) this.cache.delete(k);
    }
    return data.user;
  }
}

/** Restringe a rota a admins (usar depois do SupabaseAuthGuard) */
@Injectable()
export class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Acesso restrito ao administrador');
    }
    return true;
  }
}
