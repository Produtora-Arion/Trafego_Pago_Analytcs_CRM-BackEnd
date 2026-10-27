import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAuthGuard, AdminOnlyGuard } from './supabase-auth.guard';

interface CreateUserDto {
  email: string;
  password: string;
  name?: string;
  role: 'admin' | 'client';
  customerId?: string;
}

/** Gerenciamento de acessos — somente admin */
@Controller('users')
@UseGuards(SupabaseAuthGuard, AdminOnlyGuard)
export class UsersController {
  private admin: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    this.admin = createClient(
      this.config.getOrThrow('SUPABASE_URL'),
      this.config.getOrThrow('SUPABASE_SECRET_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  private mapUser(u: any) {
    return {
      id: u.id,
      email: u.email,
      name: u.user_metadata?.name ?? null,
      role: u.app_metadata?.role ?? 'client',
      customerId: u.app_metadata?.customer_id ?? null,
      // Cópia em texto puro guardada só pra admin conseguir ver/repassar a senha
      // depois — o Supabase Auth em si só guarda o hash (nunca recuperável).
      // Ver aviso de segurança no comentário acima de createUser().
      password: u.user_metadata?.plain_password ?? null,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
    };
  }

  @Get()
  async list() {
    const { data, error } = await this.admin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new BadRequestException(error.message);
    return data.users.map((u) => this.mapUser(u));
  }

  /**
   * ATENÇÃO: guardamos a senha em texto puro em user_metadata.plain_password
   * só pra admin conseguir ver/repassar depois (pedido explícito — o Supabase
   * Auth em si nunca expõe a senha de volta, só o hash). Isto é um trade-off
   * de segurança ciente: se este banco vazar, essas senhas vazam também.
   */
  @Post()
  async create(@Body() body: CreateUserDto) {
    if (!body.email || !body.password) {
      throw new BadRequestException('Email e senha são obrigatórios');
    }
    if (body.password.length < 8) {
      throw new BadRequestException('A senha deve ter pelo menos 8 caracteres');
    }
    if (body.role === 'client' && !body.customerId) {
      throw new BadRequestException('Acesso de cliente precisa de um customerId vinculado');
    }

    const { data, error } = await this.admin.auth.admin.createUser({
      email: body.email.trim().toLowerCase(),
      password: body.password,
      email_confirm: true,
      app_metadata: {
        role: body.role,
        customer_id: body.role === 'client' ? body.customerId : null,
      },
      user_metadata: { name: body.name ?? null, plain_password: body.password },
    });
    if (error) throw new BadRequestException(error.message);
    return this.mapUser(data.user);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Partial<CreateUserDto>,
  ) {
    const attrs: any = {};
    if (body.password) {
      if (body.password.length < 8) {
        throw new BadRequestException('A senha deve ter pelo menos 8 caracteres');
      }
      attrs.password = body.password;
    }
    if (body.role || body.customerId !== undefined) {
      attrs.app_metadata = {
        ...(body.role ? { role: body.role } : {}),
        ...(body.customerId !== undefined ? { customer_id: body.customerId } : {}),
      };
    }
    if (body.name !== undefined || body.password) {
      // user_metadata é substituído por inteiro pelo Supabase — busca o atual
      // pra não apagar o nome ao trocar só a senha (ou vice-versa).
      const { data: existing, error: fetchErr } = await this.admin.auth.admin.getUserById(id);
      if (fetchErr) throw new BadRequestException(fetchErr.message);
      attrs.user_metadata = {
        ...existing.user.user_metadata,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.password ? { plain_password: body.password } : {}),
      };
    }

    const { data, error } = await this.admin.auth.admin.updateUserById(id, attrs);
    if (error) throw new BadRequestException(error.message);
    return this.mapUser(data.user);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const { error } = await this.admin.auth.admin.deleteUser(id);
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }
}
