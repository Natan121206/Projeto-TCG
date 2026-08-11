const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const cartaController = require('./controllers/cartaController');
const Carta = require('./models/Carta');
const session = require('express-session');
const User = require('./models/User');
const axios = require('axios');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
require('dotenv').config();

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- CONEXÃO COM O BANCO DE DADOS ---
const mongoURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/onepiece_deck';
mongoose.connect(mongoURI)
    .then(() => console.log('Conectado ao MongoDB Atlas com sucesso!'))
    .catch((err) => console.error('Erro de conexão ao MongoDB:', err)); 

// Configurações
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Importante para lidar com dados JSON
app.use(express.static('public'));
app.use(session({
    secret: 'segredo-do-one-piece',
    resave: false,
    saveUninitialized: true
}));



router.post('/api/identificar-carta', async (req, res) => {
    try {
        const { imagem } = req.body;

        if (!imagem) {
            return res.status(400).json({ sucesso: false, mensagem: "Imagem não enviada." });
        }

        // Converter imagem Base64 em Buffer
        const base64Data = imagem.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Pega dimensões da foto
        const metadata = await sharp(imageBuffer).metadata();
        const width = metadata.width;
        const height = metadata.height;

        /* 
          RECORTE E TRATAMENTO DA IMAGEM:
          As cartas de One Piece TCG têm o código no canto inferior direito.
          Abaixo pegamos os últimos 20% da altura e 45% da largura direita.
        */
        const cropLeft = Math.floor(width * 0.55);
        const cropTop = Math.floor(height * 0.80);
        const cropWidth = Math.floor(width * 0.45);
        const cropHeight = Math.floor(height * 0.20);

        const imagemTratada = await sharp(imageBuffer)
            .extract({
                left: cropLeft,
                top: cropTop,
                width: cropWidth,
                height: cropHeight
            })
            .resize(800) // Redimensiona para aumentar os caracteres pequenos
            .grayscale() // Transforma em escala de cinza
            .linear(1.5, -30) // Aumenta o contraste entre o texto e o fundo
            .threshold(150) // Converte estritamente para Preto e Branco (binarização)
            .toBuffer();

        // Leitura com Tesseract.js restrito
        const { data: { text } } = await Tesseract.recognize(
            imagemTratada,
            'eng',
            {
                // Aceita APENAS caracteres que compõem o código
                tessedit_char_whitelist: 'OPSTEB0123456789-' 
            }
        );

        console.log("Texto limpo detectado:", text.trim());

        // REGEX EXCLUSIVO PARA ONE PIECE TCG (Formatos: OP01-016, ST01-001, EB01-001, P-001)
        const regexCodigo = /(OP\d{2}-\d{3}|ST\d{2}-\d{3}|EB\d{2}-\d{3}|P-\d{3})/i;
        const match = text.match(regexCodigo);

        if (match) {
            const codigoFormatado = match[0].toUpperCase();
            console.log("-> Código reconhecido com sucesso:", codigoFormatado);

            return res.json({
                sucesso: true,
                codigo: codigoFormatado
            });
        }

        // Se o recorte focado falhar, retorna que ainda está buscando
        return res.json({
            sucesso: false,
            mensagem: "Procurando código..."
        });

    } catch (error) {
        console.error("Erro ao processar imagem:", error);
        return res.status(500).json({ sucesso: false, mensagem: "Erro interno no servidor." });
    }
});

module.exports = router;


// Função para extrair os preços diretamente do schema da OPTCG API
function extrairPreco(cardData) {
    // A API envia inventory_price e market_price
    const rawMin = cardData.inventory_price ?? 0;
    const rawMax = cardData.market_price ?? 0;

    const parseVal = (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') return parseFloat(val.replace(/[^0-9.-]+/g, '')) || 0;
        return 0;
    };

    return {
        valorMin: parseVal(rawMin),
        valorMax: parseVal(rawMax)
    };
}

// rotas
app.get('/perfil', (req, res) => {
    res.render('perfil');
});

//app.get('/limpar-banco-total', async (req, res) => {
//    const Carta = require('./models/Carta');
//    await Carta.deleteMany({}); // Apaga TUDO
//    res.send("Banco limpo! Pode voltar para a home e remover esta rota do código.");
//});


app.get('/login', (req, res) => {
    res.render('login');
});

// Rota para mostrar a página de CADASTRO
app.get('/registrar', (req, res) => {
    res.render('registrar');
});

app.post('/registrar', async (req, res) => {
    const { nome, email, password } = req.body;
    try {
        const novoUsuario = new User({ nome, email, password });
        await novoUsuario.save();
        res.redirect('/login');
    } catch (err) {
        res.send("Erro ao registrar: " + err.message);
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
        req.session.userId = user._id;
        req.session.userName = user.nome;
        res.redirect('/');
    } else {
        res.send("Email ou senha incorretos.");
    }
});

// ROTA DE LOGOUT
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});



const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// ROTA PRINCIPAL: LISTAR COM FILTROS COMBINADOS
// ==========================================
app.get('/', async (req, res) => {
    try {
        if (!req.session.userId) return res.redirect('/login');

        // Captura os parâmetros da URL: ?tipo=Event&foil=true&arteAlt=true
        const { foil, tipo, arteAlt } = req.query; 
        let queryMongo = { userId: req.session.userId };

        // Filtro de Acabamento Foil
        if (foil === 'true') {
            queryMongo.isFoil = true;
        }

        // Filtro de Tag de Arte Alternativa
        if (arteAlt === 'true') {
            queryMongo.isAlternateArt = true;
        }

        // Filtro por Tipo de Carta (Character, Event, Leader, etc.)
        if (tipo && tipo !== 'todos') {
            queryMongo.tipo = new RegExp(`^${tipo}$`, 'i');
        }

        const cartas = await Carta.find(queryMongo).sort({ _id: -1 });

        res.render('index', {
            cartas,
            userName: req.session.userName,
            filtros: {
                foil: foil || 'todos',
                tipo: tipo || 'todos',
                arteAlt: arteAlt || 'todos'
            }
        });

    } catch (error) {
        console.error("Erro na rota principal:", error);
        res.status(500).send("Erro ao carregar o deck.");
    }
});


// ==========================================
// ROTA ADICIONAR (SALVANDO O TIPO DA CARTA)
// ==========================================
app.post('/adicionar', async (req, res) => {
    try {
        if (!req.session.userId) return res.redirect('/login');

        const { idCard, quantidade, isFoil, isAlternateArt } = req.body;
        if (!idCard) return res.status(400).send("Código não informado.");

        const codigoUpper = idCard.trim().toUpperCase();
        let nome = `Carta ${codigoUpper}`;
        let tipo = 'Character';
        let valorMin = 0;
        let valorMax = 0;
        let imagem = "";

        try {
            const response = await axios.get(`https://optcgapi.com/api/sets/card/${codigoUpper}/`, { timeout: 5000 });
            const cardData = Array.isArray(response.data) ? response.data[0] : response.data;

            if (cardData) {
                nome = cardData.card_name || cardData.name || nome;
                tipo = cardData.card_type || cardData.type || tipo;
                imagem = cardData.card_image || cardData.image || "";

                const precos = extrairPreco(cardData);
                valorMin = precos.valorMin;
                valorMax = precos.valorMax;
            }
        } catch (apiError) {
            console.warn(`[API Aviso] Não foi possível consultar "${codigoUpper}".`);
        }

        const novaCarta = new Carta({
            idCard: codigoUpper,
            nome,
            tipo,
            valorMin,
            valorMax,
            quantidade: (quantidade && quantidade > 0) ? parseInt(quantidade) : 1,
            imagem,
            isFoil: isFoil === 'on' || isFoil === true,
            isAlternateArt: isAlternateArt === 'on' || isAlternateArt === true, // Salva se é Arte Alternativa
            userId: req.session.userId
        });

        await novaCarta.save();
        res.redirect('/');

    } catch (error) {
        console.error("Erro ao cadastrar:", error);
        res.status(500).send("Erro interno ao cadastrar.");
    }
});


// ==========================================
// ROTA ATUALIZAR PREÇOS E TIPOS DE ANTIGAS
// ==========================================
app.get('/atualizar-precos', async (req, res) => {
    try {
        if (!req.session.userId) return res.redirect('/login');

        const cartas = await Carta.find({ userId: req.session.userId });

        for (const carta of cartas) {
            try {
                const response = await axios.get(`https://optcgapi.com/api/sets/card/${carta.idCard}/`, { timeout: 4000 });
                const cardData = Array.isArray(response.data) ? response.data[0] : response.data;

                if (cardData) {
                    const precos = extrairPreco(cardData);
                    const tipoAtualizado = cardData.card_type || carta.tipo;
                    const imagemAtualizada = cardData.card_image || carta.imagem;

                    await Carta.findByIdAndUpdate(carta._id, {
                        valorMin: precos.valorMin || carta.valorMin,
                        valorMax: precos.valorMax || carta.valorMax,
                        tipo: tipoAtualizado,
                        imagem: imagemAtualizada
                    });
                }
            } catch (err) {
                console.error(`Erro ao atualizar ${carta.idCard}: ${err.message}`);
            }

            await delay(300);
        }

        res.redirect('/');

    } catch (error) {
        console.error("Erro na atualização:", error);
        res.status(500).send("Erro ao atualizar.");
    }
});


// Rota para deletar uma carta
app.get('/deletar/:id', async (req, res) => {
    try {
        const id = req.params.id; // Pega o ID que vem na URL
        const Carta = require('./models/Carta'); // Verifique se o caminho está certo

        await Carta.findByIdAndDelete(id); // Deleta no MongoDB
        
        console.log(`Carta ${id} removida com sucesso.`);
        res.redirect('/'); // Recarrega a página inicial
    } catch (error) {
        console.error("Erro ao deletar:", error);
        res.status(500).send("Erro ao tentar remover a carta.");
    }
});
// 1. Rota para abrir a página de edição (GET)
app.get('/editar/:id', async (req, res) => {
    try {
        const Carta = require('./models/Carta');
        const carta = await Carta.findById(req.params.id);
        res.render('editar', { carta }); // Vamos criar o editar.ejs
    } catch (error) {
        res.status(500).send("Erro ao buscar carta para edição.");
    }
});

// 2. Rota para salvar as alterações (POST)
app.post('/editar/:id', async (req, res) => {
    try {
        const { idCard, nome, valorMin, valorMax, quantidade } = req.body;
        const Carta = require('./models/Carta');

        await Carta.findByIdAndUpdate(req.params.id, {
            idCard: idCard.toUpperCase(),
            nome,
            valorMin: parseFloat(valorMin),
            valorMax: parseFloat(valorMax),
            quantidade: (quantidade && quantidade > 0) ? parseInt(quantidade) : 1
        });

        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.status(500).send("Erro ao atualizar.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});

// comando para iniciar o site: npm run dev


// Função para extrair e converter o preço retornado pela API
