import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { SupabaseAuthGuard, AdminOnlyGuard, AuthUser } from '../auth/supabase-auth.guard';

/**
 * Relatório Mensal — geração e configuração são só pra admin (AdminOnlyGuard).
 * Leitura (listar/ver um relatório) é aberta pros dois papéis: o filtro de
 * "só liberado" pro cliente acontece dentro do service, nunca confiado à rota.
 */
@Controller('reports')
@UseGuards(SupabaseAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  private isAdmin(req: any): boolean {
    return (req.user as AuthUser | undefined)?.role === 'admin';
  }

  private tenant(req: any): string | null {
    const u = req.user as AuthUser | undefined;
    return u && u.role !== 'admin' ? u.customerId : null;
  }

  @Get(':customerId/campaign-options')
  @UseGuards(AdminOnlyGuard)
  getCampaignOptions(@Param('customerId') customerId: string) {
    return this.reports.getCampaignOptions(customerId);
  }

  @Get(':customerId/selection')
  @UseGuards(AdminOnlyGuard)
  getSelection(@Param('customerId') customerId: string) {
    return this.reports.getSelection(customerId);
  }

  @Post(':customerId/selection')
  @UseGuards(AdminOnlyGuard)
  saveSelection(
    @Param('customerId') customerId: string,
    @Body('items') items: { platform: 'google' | 'meta'; campaignId: string; campaignName?: string; accountId?: string }[],
  ) {
    return this.reports.saveSelection(customerId, items ?? []);
  }

  @Get(':customerId/generate')
  @UseGuards(AdminOnlyGuard)
  generate(@Param('customerId') customerId: string, @Query('month') month: string) {
    if (!month) throw new BadRequestException('month é obrigatório (YYYY-MM)');
    return this.reports.generate(customerId, month);
  }

  @Post(':customerId')
  @UseGuards(AdminOnlyGuard)
  async create(
    @Param('customerId') customerId: string,
    @Body('month') month: string,
    @Body('data') data: any,
    @Body('observations') observations: string | null,
  ) {
    if (!month || !data) throw new BadRequestException('month e data são obrigatórios');
    return this.reports.create(customerId, month, data, observations ?? null);
  }

  @Get(':customerId')
  findAll(@Param('customerId') customerIdParam: string, @Req() req: any) {
    const customerId = this.tenant(req) ?? customerIdParam;
    return this.reports.findAll(customerId, this.isAdmin(req));
  }

  @Get(':customerId/:id')
  findOne(@Param('customerId') customerIdParam: string, @Param('id') id: string, @Req() req: any) {
    const customerId = this.tenant(req) ?? customerIdParam;
    return this.reports.findOne(Number(id), customerId, this.isAdmin(req));
  }

  @Patch(':customerId/:id/observations')
  @UseGuards(AdminOnlyGuard)
  updateObservations(
    @Param('customerId') customerId: string,
    @Param('id') id: string,
    @Body('observations') observations: string,
  ) {
    return this.reports.updateObservations(Number(id), customerId, observations ?? '');
  }

  @Patch(':customerId/:id/release')
  @UseGuards(AdminOnlyGuard)
  setReleased(
    @Param('customerId') customerId: string,
    @Param('id') id: string,
    @Body('released') released: boolean,
  ) {
    return this.reports.setReleased(Number(id), customerId, !!released);
  }

  @Delete(':customerId/:id')
  @UseGuards(AdminOnlyGuard)
  delete(@Param('customerId') customerId: string, @Param('id') id: string) {
    return this.reports.delete(Number(id), customerId);
  }
}
