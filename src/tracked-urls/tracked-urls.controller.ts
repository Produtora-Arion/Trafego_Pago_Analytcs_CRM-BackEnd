import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TrackedUrlsService } from './tracked-urls.service';
import { CreateTrackedUrlDto, UpdateTrackedUrlDto } from './tracked-urls.dto';
import { SupabaseAuthGuard, AdminOnlyGuard } from '../auth/supabase-auth.guard';

/** Cadastro e métricas de URLs monitoradas — 100% administrativo, sem vínculo com cliente/conta do CRM. */
@Controller('tracked-urls')
@UseGuards(SupabaseAuthGuard, AdminOnlyGuard)
export class TrackedUrlsController {
  constructor(private readonly service: TrackedUrlsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() body: CreateTrackedUrlDto) {
    return this.service.create(body.name, body.url);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateTrackedUrlDto) {
    return this.service.update(Number(id), body);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(Number(id));
  }

  @Get(':id/metrics')
  getMetrics(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getMetrics(Number(id), from, to);
  }

  @Get(':id/submissions')
  getSubmissions(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getSubmissions(Number(id), from, to);
  }

  @Get(':id/utm')
  getUtmBreakdown(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getUtmBreakdown(Number(id), from, to);
  }

  @Get(':id/utm-daily')
  getUtmBreakdownByDay(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getUtmBreakdownByDay(Number(id), from, to);
  }

  @Get(':id/clicks')
  getClickBreakdown(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getClickBreakdown(Number(id), from, to);
  }

  @Get(':id/clicks-daily')
  getClickBreakdownByDay(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getClickBreakdownByDay(Number(id), from, to);
  }

  @Get(':id/views')
  getViewBreakdown(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getViewBreakdown(Number(id), from, to);
  }

  @Get(':id/views-metrics')
  getViewMetrics(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getViewMetrics(Number(id), from, to);
  }

  @Get(':id/clicks-utm')
  getClickBreakdownByUtm(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getClickBreakdownByUtm(Number(id), from, to);
  }

  @Get(':id/views-utm')
  getViewBreakdownByUtm(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getViewBreakdownByUtm(Number(id), from, to);
  }
}
