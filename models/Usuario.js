const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true } // Em um sistema real, usaríamos bcrypt para criptografar
});

module.exports = mongoose.model('User', userSchema);