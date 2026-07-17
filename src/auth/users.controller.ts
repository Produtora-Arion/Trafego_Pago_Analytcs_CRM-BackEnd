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
      user_metadata: { name: body.name ?? null },
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
    if (body.name !== undefined) attrs.user_metadata = { name: body.name };

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
