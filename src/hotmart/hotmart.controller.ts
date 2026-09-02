import { BadRequestException, Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { HotmartService } from './hotmart.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

@Controller('hotmart')
export class HotmartController {
  constructor(private readonly hotmart: HotmartService) {}

  /**
   * Público — chamado pelo próprio site do cliente (JS no navegador) ao
   * carregar a página com um fbclid na URL. Sem autenticação: não expõe
   * nada sensível, só recebe um fbclid e devolve um código curto.
   */
  @Post(':customerId/click')
  async registerClick(
    @Param('customerId') customerId: string,
    @Body('fbclid') fbclid: string,
  ) {
    if (!fbclid) throw new BadRequestException('fbclid é obrigatório');
    const ref = await this.hotmart.registerClick(customerId, fbclid);
    return { ref };
  }

  /**
   * Público — chamado pelos servidores da Hotmart quando uma venda muda de
   * status. Sem guard de sessão (a Hotmart não faz login), a autenticidade é
   * validada por dentro via o Hottok, comparado em tempo constante.
   */
  @Post(':customerId/webhook')
  async webhook(
    @Param('customerId') customerId: string,
    @Headers('x-hotmart-hottok') hottokHeader: string | undefined,
    @Body() body: any,
  ) {
    return this.hotmart.processPurchase(customerId, hottokHeader, body);
  }

  /** Admin — lista as vendas registradas desse cliente, pra exibir no CRM. */
  @Get(':customerId/sales')
  @UseGuards(SupabaseAuthGuard)
  async listSales(@Param('customerId') customerId: string) {
    return this.hotmart.listSales(customerId);
  }
}
