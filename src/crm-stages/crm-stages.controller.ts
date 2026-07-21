import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { CrmStagesService } from './crm-stages.service';
import { CreateCrmStageDto, UpdateCrmStageDto, ReorderCrmStagesDto } from './crm-stages.dto';
import { SupabaseAuthGuard, AuthUser } from '../auth/supabase-auth.guard';

@Controller('crm-stages')
@UseGuards(SupabaseAuthGuard)
export class CrmStagesController {
  constructor(private readonly service: CrmStagesService) {}

  /** null para admin (acesso total), customerId do token para cliente */
  private tenant(req: any): string | null {
    const u = req.user as AuthUser | undefined;
    return u && u.role !== 'admin' ? u.customerId : null;
  }

  /** Cliente sempre força o próprio customerId (nunca confia no query param); admin pode filtrar por qualquer um. */
  @Get()
  findAll(@Query('customerId') customerId: string, @Req() req: any) {
    return this.service.findAll(this.tenant(req) ?? customerId);
  }

  /** Cliente sempre força o próprio customerId (nunca confia no body); admin pode informar qualquer um. */
  @Post()
  create(@Body() body: CreateCrmStageDto, @Req() req: any) {
    const customerId = this.tenant(req) ?? body.customerId;
    return this.service.create(customerId!, body.label, body.color, body.triggersConversion ?? false, body.isEntryStage ?? false);
  }

  @Patch('reorder')
  reorder(@Body() body: ReorderCrmStagesDto, @Req() req: any) {
    const customerId = this.tenant(req) ?? body.customerId;
    return this.service.reorder(customerId!, body.orderedIds);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateCrmStageDto, @Req() req: any) {
    return this.service.update(Number(id), body, this.tenant(req));
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.service.delete(Number(id), this.tenant(req));
  }
}
