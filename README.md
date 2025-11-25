## 🚀 Como subir sua infraestrutura e rodar o jogo

Siga os passos abaixo para criar sua infraestrutura na DigitalOcean e publicar seu próprio jogo:

1. **Crie sua conta na DigitalOcean**  
   Use o link: https://m.do.co/c/a5371331c01f

2. **Gere seu Token de API**  
   No painel da DigitalOcean, acesse **API** → **Generate New Token** e crie um token com permissões de leitura/escrita.

3. **Faça um fork desse repositório** 

4. **Adicione o token nas secrets do GitHub**  
   No seu repositório, acesse:  
   **Settings** → **Secrets and Variables** → **Actions** → **New repository secret**

5. **Crie a secret `DO_TOKEN`**  
   - **Name:** `DO_TOKEN`  
   - **Secret:** cole o token gerado no passo 2.

6. **Execute o workflow de infraestrutura**  
   Vá até **Actions** → **Create Infrastructure** → selecione o workflow e clique em **Run workflow**.

7. **Aguarde o término da pipeline**  
   Assim que finalizar, acesse seu jogo pelo link:  
   ```
   https://suaconta.k8sgame.win
   ```
   > **Obs:** *suaconta* é exatamente o seu nome de usuário do GitHub porém minusculo.

Pronto! Sua infraestrutura estará criada automaticamente e seu jogo já estará no ar. 🎮🔥
