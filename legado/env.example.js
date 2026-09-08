// Modelo do env.js — copie para `env.js` e preencha com os valores reais.
//
//   cp env.example.js env.js
//
// O `env.js` está no .gitignore e NUNCA deve ser commitado. É o mesmo
// papel do `.env` do sgc-seteg, adaptado a um site sem build: aqui não há
// Vite para embutir variável nenhuma, então o arquivo é um .js que o
// index.html carrega antes do script.js.
//
// ATENÇÃO — vale a mesma ressalva escrita no app.js do SGC: isto tira a
// chave do REPOSITÓRIO, não do NAVEGADOR. O app chama o Clockify direto,
// então a chave viaja no cabeçalho da requisição e aparece para quem
// abrir o DevTools no site publicado. Tirá-la do navegador exigiria uma
// função no servidor repassando a chamada.
//
// E como o deploy é direto da pasta, sem build: o env.js não vai para o
// Git, então ele precisa ser posto à mão no que for publicado. Sem ele, o
// campo Código Clockify fica sem sugestões — e só isso: o resto do
// sistema funciona igual.

// Clockify → Preferences → Advanced → API key.
window.CLOCKIFY_API_KEY = "";

// Só se a conta tiver mais de um workspace. Em branco, usa o primeiro.
window.CLOCKIFY_WORKSPACE_ID = "";
