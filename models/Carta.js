const mongoose = require('mongoose');

const cartaSchema = new mongoose.Schema({
    idCard: String,
    nome: String,
    tipo: { type: String, default: 'Character' },
    valorMin: Number,
    valorMax: Number,
    quantidade: Number,
    imagem: String,
    isFoil: { type: Boolean, default: false },
    isAlternateArt: { type: Boolean, default: false }, // Campo para Arte Alternativa
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

module.exports = mongoose.model('Carta', cartaSchema);