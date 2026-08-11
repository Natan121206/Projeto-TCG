const Carta = require('../models/Carta');

exports.adicionarCarta = async (req, res) => {
    try {
        const { idCard, nome, valorMin, valorMax } = req.body;

        const novaCarta = new Carta({
            idCard: idCard.toUpperCase(),
            nome: nome,
            valorMin: parseFloat(valorMin),
            valorMax: parseFloat(valorMax)
        });

        await novaCarta.save();
        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.status(500).send("Erro ao salvar a carta manualmente.");
    }
};

exports.listarCartas = async (req, res) => {
    try {
        const cartas = await Carta.find();
        res.render('index', { cartas: cartas }); // 'cartas' à esquerda é o nome no EJS, à direita é a variável do banco
    } catch (err) {
        res.render('index', { cartas: [] }); // Plano de segurança: envia lista vazia se der erro
    }
};