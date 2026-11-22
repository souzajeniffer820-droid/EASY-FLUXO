# CicloLivre

Aplicativo de acompanhamento de saúde hormonal e reprodutiva, adaptado a diferentes fases de vida
(ciclo, tentativa de gravidez, gestação, puerpério e perimenopausa), sem previsões rígidas de 28
dias e sem alertas punitivos.

Stack: **React 18 + Vite 6 + Tailwind CSS 4 + Capacitor 7 (Android)**.

## Funcionalidades

- **5 modos de vida**: Acompanhar Ciclo, Tentando Engravidar (TTC), Gravidez, Pós-Parto e
  Perimenopausa — cada um altera previsões, alertas e campos disponíveis.
- **Contracepção e condições de saúde**: laqueadura, vasectomia (com trava de segurança até o
  espermograma de confirmação), métodos hormonais contínuos, endometriose, adenomiose, SOP, miomas,
  quimioterapia e pós-histerectomia.
- **14 categorias de registro diário** + escala de dor 0–10, temperatura basal, testes de LH/gravidez,
  peso e anotações livres.
- **Calendário** com marcação de fluxo, sintomas, previsão do próximo ciclo e histórico real de
  ciclos.
- **Algoritmo adaptativo**: calcula média real do ciclo, duração da menstruação e variação a partir
  dos episódios de sangramento registrados.
- **Previsão na tela inicial**: mostra a próxima menstruação e a ovulação estimada (com janela fértil
  e nível de confiança) assim que o app abre.
- **Contador de contrações** com regra 5-1-1 para a gestação.
- **IMC automático** a partir do peso registrado e da altura do perfil.
- **Biblioteca educativa** (9 conteúdos com resumo, alerta médico e fonte) e recomendação por perfil.
- **Relatório médico** em texto, com cópia e compartilhamento nativo.
- **Múltiplos perfis** no mesmo dispositivo e persistência local (localStorage).

## Rodar no navegador

```bash
npm install
npm run dev
```

## Gerar o APK Android

Pré-requisitos: Node.js 20+, JDK 17 e Android SDK (platform 35 + build-tools 35.0.0).

```bash
npm install
npm run build
npx cap sync android
cd android
./gradlew.bat assembleDebug
```

O APK sai em `android/app/build/outputs/apk/debug/app-debug.apk`.

Para gerar um APK/AAB de release assinado, crie um keystore e configure `signingConfigs` em
`android/app/build.gradle`:

```bash
keytool -genkey -v -keystore ciclolivre.jks -keyalg RSA -keysize 2048 -validity 10000 -alias ciclolivre
```

## Estrutura

```
src/
  App.jsx          # shell do app, abas, cálculos de ciclo e status
  data.js          # modos, métodos, condições, categorias e biblioteca de conteúdos
  utils.js         # datas, IMC e formatação
  index.css        # Tailwind + ajustes de app nativo
android/           # projeto nativo Capacitor
tools/             # scripts auxiliares (geração de ícones/splash)
```

## Privacidade

Nenhum dado sai do dispositivo: não há backend, conta ou telemetria. Os registros ficam no
armazenamento local do app.....
