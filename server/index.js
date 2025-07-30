const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://cesf-conselho.vercel.app/', // Substitua pelo URL do seu frontend no Vercel
    methods: ['GET', 'POST'],
  },
});

// Conectar ao MongoDB
mongoose.connect('mongodb+srv://<seu-usuario>:<sua-senha>@cluster0.mongodb.net/cesf?retryWrites=true&w=majority', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('Conectado ao MongoDB')).catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// Schemas do MongoDB
const UserSchema = new mongoose.Schema({
  nome: { type: String, required: true, unique: true },
  senha: { type: String, required: true },
  ano: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  isSuperAdmin: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false },
});

const AnoSchema = new mongoose.Schema({
  nome: { type: String, required: true, unique: true },
  pontos: { type: Number, default: 0 },
});

const HistoricoSchema = new mongoose.Schema({
  ano: String,
  pontos: Number,
  motivo: String,
  admin: String,
  data: { type: Date, default: Date.now },
});

const MensagemSchema = new mongoose.Schema({
  remetente: String,
  destinatario: String,
  texto: String,
  data: { type: Date, default: Date.now },
});

const User = mongoose.model('User', UserSchema);
const Ano = mongoose.model('Ano', AnoSchema);
const Historico = mongoose.model('Historico', HistoricoSchema);
const Mensagem = mongoose.model('Mensagem', MensagemSchema);

// Inicializar dados padrão
async function initializeDB() {
  const adminCount = await User.countDocuments({ isAdmin: true });
  if (adminCount === 0) {
    await User.create([
      { nome: 'João Neto', senha: await bcrypt.hash('11/06/25', 10), ano: '8º ano', isAdmin: true, isSuperAdmin: true },
      { nome: 'Petro Gabriel', senha: await bcrypt.hash('lideranca24', 10), ano: '8º ano', isAdmin: true, isSuperAdmin: false },
    ]);
  }
  const anoCount = await Ano.countDocuments();
  if (anoCount === 0) {
    await Ano.create([
      { nome: '6º ano', pontos: 1200 },
      { nome: '7º ano', pontos: 900 },
      { nome: '8º ano', pontos: 700 },
      { nome: '9º ano', pontos: 500 },
    ]);
  }
}
initializeDB();

// Armazenar usuários online
let onlineUsers = [];

io.on('connection', (socket) => {
  console.log('Usuário conectado:', socket.id);

  socket.on('userLogin', async (user) => {
    onlineUsers = onlineUsers.filter(u => u.id !== socket.id);
    onlineUsers.push({ id: socket.id, ...user });
    io.emit('onlineUsers', onlineUsers);
  });

  socket.on('disconnect', () => {
    onlineUsers = onlineUsers.filter(u => u.id !== socket.id);
    io.emit('onlineUsers', onlineUsers);
    console.log('Usuário desconectado:', socket.id);
  });

  socket.on('sendMessage', async (msg) => {
    await Mensagem.create({
      remetente: msg.remetente,
      destinatario: msg.destinatario,
      texto: msg.texto,
      data: new Date(),
    });
    io.emit('receiveMessage', { ...msg, data: new Date().toLocaleString('pt-BR') });
  });
});

app.use(express.json());

// Endpoint de login
app.post('/api/login', async (req, res) => {
  const { nome, senha } = req.body;
  try {
    const user = await User.findOne({ nome });
    if (user && await bcrypt.compare(senha, user.senha)) {
      if (user.isBlocked) {
        return res.status(403).json({ error: 'Usuário bloqueado.' });
      }
      res.json({ nome: user.nome, ano: user.ano, isAdmin: user.isAdmin, isSuperAdmin: user.isSuperAdmin });
    } else {
      res.status(401).json({ error: 'Credenciais inválidas' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint de cadastro
app.post('/api/cadastro', async (req, res) => {
  const { nome, senha, ano } = req.body;
  try {
    const existingUser = await User.findOne({ nome });
    if (existingUser) {
      return res.status(400).json({ error: 'Nome já cadastrado' });
    }
    const hashedPassword = await bcrypt.hash(senha, 10);
    const user = await User.create({ nome, senha: hashedPassword, ano, isAdmin: false });
    res.json({ nome: user.nome, ano: user.ano, isAdmin: user.isAdmin });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para listar alunos
app.get('/api/alunos', async (req, res) => {
  try {
    const alunos = await User.find();
    res.json(alunos);
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para listar anos
app.get('/api/anos', async (req, res) => {
  try {
    const anos = await Ano.find();
    res.json(anos);
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para listar histórico
app.get('/api/historico', async (req, res) => {
  try {
    const historico = await Historico.find();
    res.json(historico);
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para listar mensagens
app.get('/api/mensagens/:user', async (req, res) => {
  try {
    const mensagens = await Mensagem.find({
      $or: [{ remetente: req.params.user }, { destinatario: req.params.user }],
    });
    res.json(mensagens);
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para alterar pontos
app.post('/api/pontos', async (req, res) => {
  const { ano, pontos, motivo, admin } = req.body;
  try {
    await Ano.updateOne({ nome: ano }, { $inc: { pontos: pontos } });
    await Historico.create({ ano, pontos, motivo, admin, data: new Date() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para gerenciar administradores
app.post('/api/admin', async (req, res) => {
  const { nome, action } = req.body;
  try {
    if (action === 'add') {
      await User.updateOne({ nome }, { isAdmin: true });
    } else if (action === 'remove') {
      await User.updateOne({ nome }, { isAdmin: false });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para excluir/bloquear alunos
app.post('/api/aluno', async (req, res) => {
  const { nome, action } = req.body;
  try {
    if (action === 'delete') {
      await User.deleteOne({ nome });
      await Mensagem.deleteMany({ $or: [{ remetente: nome }, { destinatario: nome }] });
    } else if (action === 'toggleBlock') {
      const user = await User.findOne({ nome });
      await User.updateOne({ nome }, { isBlocked: !user.isBlocked });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
