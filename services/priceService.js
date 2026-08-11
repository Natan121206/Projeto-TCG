const puppeteer = require('puppeteer');

exports.buscarDadosCarta = async (idCard) => {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();

        // 1. Vai para a busca
        const urlBusca = `https://www.ligaonepiece.com.br/?view=cards/search&card=${idCard}`;
        await page.goto(urlBusca, { waitUntil: 'networkidle2' });

        // 2. VERIFICAÇÃO: Estamos na lista de resultados ou na página da carta?
        // Se houver um link de carta na busca, clicamos nele
        const linkCarta = await page.$('.card-nome a, .card-name a'); 
        if (linkCarta) {
            await Promise.all([
                page.click('.card-nome a, .card-name a'),
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
            ]);
        }

        // 3. Extração dos dados finais
        const dados = await page.evaluate(() => {
            // Seletores que funcionam tanto na busca quanto na página interna
            const nome = document.querySelector('.card-nome, #card-info-nome')?.innerText;
            const preco = document.querySelector('.preco-menor, .preco-venda')?.innerText;
            const raridade = document.querySelector('.card-raridade')?.innerText;

            return { nome, preco, raridade };
        });

        await browser.close();

        if (!dados.nome) throw new Error("Não foi possível localizar o nome da carta.");

        const precoLimpo = parseFloat(
            dados.preco?.replace('R$', '').replace('.', '').replace(',', '.').trim() || "0"
        );

        return {
            nome: dados.nome.trim(),
            raridade: dados.raridade || "N/A",
            preco: precoLimpo
        };

    } catch (error) {
        if (browser) await browser.close();
        console.error("Erro no Scanner:", error.message);
        // Plano B para não quebrar o fluxo
        return { nome: `ID: ${idCard} (Não encontrado)`, raridade: "N/A", preco: 0 };
    }
};