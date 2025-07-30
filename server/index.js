const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs').promises;
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://cesf-conselho.vercel.app', // URL do frontend
    methods: ['GET', 'POST'],
  },
});

app.use(express.json());

// Caminhos dos arquivos JSON
const USERS_FILE = path.join(__dirname, 'users.json');
const ANOS_FILE = path.join(__dirname, 'anos.json');
const HISTORICO_FILE = path.join(__dirname, 'historico.json');
const MENSAGENS_FILE = path.join(__dirname, 'mensagens.json');

// Inicializar arquivos JSON se não existirem
async function initializeFiles() {
  try {
    await fs.access(USERS_FILE).catch(async () => {
      await fs.writeFile(USERS_FILE, JSON.stringify([
        { nome: 'João Neto', senha: await bcrypt.hash('11/06/25', 10), ano: '8º ano', isAdmin: true, isSuperAdmin: true, isBlocked: false },
        { nome: 'Petro Gabriel', senha: await bcrypt.hash('lideranca24', 10), ano: '8º ano', isAdmin: true, isSuperAdmin: false, isBlocked: false },
      ]));
    });
    await fs.access(ANOS_FILE).catch(async () => {
      await fs.writeFile(ANOS_FILE, JSON.stringify([
        { nome: '6º ano', pontos: 1200 },
        { nome: '7º ano', pontos: 900 },
        { nome: '8º ano', pontos: 700 },
        { nome: '9º ano', pontos: 500 },
      ]));
    });
    await fs.access(HISTORICO_FILE).catch(async () => {
      await fs.writeFile(HISTORICO_FILE, JSON.stringify([]));
    });
    await fs.access(MENSAGENS_FILE).catch(async () => {
      await fs.writeFile(MENSAGENS_FILE, JSON.stringify([]));
    });
  } catch (err) {
    console.error('Erro ao inicializar arquivos:', err);
  }
}
initializeFiles();

// Funções para ler e escrever JSON
async function readJSON(file) {
  const data = await fs.readFile(file, 'utf8');
  return JSON.parse(data);
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

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
    const mensagens = await readJSON(MENSAGENS_FILE);
    const mensagem = { ...msg, data: new Date().toISOString() };
    mensagens.push(mensagem);
    await writeJSON(MENSAGENS_FILE, mensagens);
    io.emit('receiveMessage', { ...msg, data: new Date().toLocaleString('pt-BR') });
  });
});

// Endpoint de login
app.post('/api/login', async (req, res) => {
  const { nome, senha } = req.body;
  try {
    const users = await readJSON(USERS_FILE);
    const user = users.find(u => u.nome === nome);
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
    const users = await readJSON(USERS_FILE);
    if (users.find(u => u.nome === nome)) {
      return res.status(400).json({ error: 'Nome já cadastrado' });
    }
    const hashedPassword = await bcrypt.hash(senha, 10);
    const newUser = { nome, senha: hashedPassword, ano, isAdmin: false, isSuperAdmin: false, isBlocked: false };
    users.push(newUser);
    await writeJSON(USERS_FILE, users);
    res.json({ nome, ano, isAdmin: false });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para listar alunos
app.get('/api/alunos', async (req, res) => {
  try {
    const users = await readJSON(USERS_FILE);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para listar anos
app.get('/api/anos', async (req, res) => {
  try {
    const anos = await readJSON(ANOS_FILE);
    res.json(anos);
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para listar histórico
app.get('/api/historico', async (req, res) => {
  try {
    const historico = await readJSON(HISTORICO_FILE);
    res.json(historico);
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para listar mensagens
app.get('/api/mensagens/:user', async (req, res) => {
  try {
    const mensagens = await readJSON(MENSAGENS_FILE);
    const userMessages = mensagens.filter(msg => 
      msg.remetente === req.params.user || msg.destinatario === req.params.user
    );
    res.json(userMessages);
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para alterar pontos
app.post('/api/pontos', async (req, res) => {
  const { ano, pontos, motivo, admin } = req.body;
  try {
    const anos = await readJSON(ANOS_FILE);
    const anoData = anos.find(a => a.nome === ano);
    if (anoData) {
      anoData.pontos += pontos;
      await writeJSON(ANOS_FILE, anos);
      const historico = await readJSON(HISTORICO_FILE);
      historico.push({ ano, pontos, motivo, admin, data: new Date().toISOString() });
      await writeJSON(HISTORICO_FILE, historico);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Ano não encontrado' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para gerenciar administradores
app.post('/api/admin', async (req, res) => {
  const { nome, action } = req.body;
  try {
    const users = await readJSON(USERS_FILE);
    const user = users.find(u => u.nome === nome);
    if (user) {
      if (action === 'add') {
        user.isAdmin = true;
      } else if (action === 'remove') {
        user.isAdmin = false;
      }
      await writeJSON(USERS_FILE, users);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Usuário não encontrado' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Endpoint para excluir/bloquear alunos
app.post('/api/aluno', async (req, res) => {
  const { nome, action } = req.body;
  try {
    const users = await readJSON(USERS_FILE);
    const userIndex = users.findIndex(u => u.nome === nome);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    if (action === 'delete') {
      users.splice(userIndex, 1);
      await writeJSON(USERS_FILE, users);
      const mensagens = await readJSON(MENSAGENS_FILE);
      const mensagensFiltradas = mensagens.filter(msg => 
        msg.remetente !== nome && msg.destinatario !== nome
      );
      await writeJSON(MENSAGENS_FILE, mensagensFiltradas);
    } else if (action === 'toggleBlock') {
      users[userIndex].isBlocked = !users[userIndex].isBlocked;
      await writeJSON(USERS_FILE, users);
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
