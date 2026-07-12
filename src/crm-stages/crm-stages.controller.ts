import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { CrmStagesService } from './crm-stages.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

@Controller('crm-stages')
@UseGuards(ApiKeyGuard)
export class CrmStagesController {
  constructor(private readonly service: CrmStagesService) {}

  @Get()
  findAll(@Query('customerId') customerId: string) {
    return this.service.findAll(customerId);
  }

  @Post()
  create(@Body() body: { customerId: string; label: string; color: string; triggersConversion?: boolean }) {
    return this.service.create(body.customerId, body.label, body.color, body.triggersConversion ?? false);
  }

  @Patch('reorder')
  reorder(@Body() body: { customerId: string; orderedIds: number[] }) {
    return this.service.reorder(body.customerId, body.orderedIds);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { label?: string; color?: string; triggersConversion?: boolean }) {
    return this.service.update(Number(id), body);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(Number(id));
  }
}
