# Apache Hop — qualidade do ar

O pipeline `vivasaude-air-quality.hpl` faz uma integração ETL executável:

1. **Extract:** consulta a API pública Open-Meteo para Campinas.
2. **Transform:** lê `observation_time`, PM2.5 e PM10 da resposta JSON.
3. **Load:** grava `output/air_quality.csv`, sem dados pessoais.

## Preparar no Apache Hop

1. Baixe e abra o Apache Hop GUI (versão 2.x).
2. Crie ou selecione um projeto Hop com `PROJECT_HOME` apontando para `integrations/apache-hop`.
3. Copie a pasta `metadata/rest-connection` deste diretório para a pasta `metadata/rest-connection` do projeto selecionado. No Hop GUI, atualize as conexões de metadados e verifique **Open-Meteo Air Quality**. A API é pública e não exige chave.
4. Abra `vivasaude-air-quality.hpl` no Hop GUI, revise a transformação REST e execute o pipeline. A primeira leitura horária de Campinas será salva em `integrations/apache-hop/output/air_quality.csv`.
5. Inicie o backend e clique em **Importar saída do Hop** no painel **Central de dados**. O endpoint `POST /api/import-hop` valida o CSV, carrega SQLite, atualiza DuckDB e arquiva a saída em MongoDB quando disponível.

O pipeline está preparado para Campinas. Para representar outro município, altere latitude/longitude e adapte o código do território no backend antes de importar. O backend também oferece `POST /api/sync`, que executa o mesmo fluxo por Python para facilitar demonstração quando o Hop não estiver instalado.
