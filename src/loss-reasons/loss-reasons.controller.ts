import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { LossReasonsService } from './loss-reasons.service';
import { CreateLossReasonDto, UpdateLossReasonDto } from './loss-reasons.dto';
import { SupabaseAuthGuard, AuthUser } from '../auth/supabase-auth.guard';

@Controller('loss-reasons')
@UseGuards(SupabaseAuthGuard)
export class LossReasonsController {
  constructor(private readonly service: LossReasonsService) {}

  /** null para admin (acesso total), customerId do token para cliente */
  private tenant(req: any): string | null {
    const u = req.user as AuthUser | undefined;
    return u && u.role !== 'admin' ? u.customerId : null;
  }

  @Get()
  findAll(@Query('customerId') customerId: string, @Req() req: any) {
    return this.service.findAll(this.tenant(req) ?? customerId);
  }

  @Post()
  create(@Body() body: CreateLossReasonDto, @Req() req: any) {
    const customerId = this.tenant(req) ?? body.customerId;
    return this.service.create(customerId!, body.label);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateLossReasonDto, @Req() req: any) {
    return this.service.update(Number(id), body, this.tenant(req));
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.service.delete(Number(id), this.tenant(req));
  }
}
