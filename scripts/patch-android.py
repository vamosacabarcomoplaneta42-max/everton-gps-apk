"""Ajusta o projeto Android gerado pelo Capacitor:
- permissões e serviço de localização em segundo plano (AndroidManifest.xml)
- versão do app que sobe a cada compilação
- assinatura fixa, para poder instalar uma versão nova por cima da anterior
"""
import os
import pathlib
import re

# ---------- AndroidManifest.xml ----------
manifesto = pathlib.Path("android/app/src/main/AndroidManifest.xml")
xml = manifesto.read_text(encoding="utf-8")

permissoes = [
    "INTERNET",
    "ACCESS_FINE_LOCATION",
    "ACCESS_COARSE_LOCATION",
    # CORREÇÃO: faltava esta permissão. Sem ela, no Android 10+ o sistema nem
    # oferece a opção "Permitir o tempo todo" na tela de permissão de
    # localização — só "Permitir enquanto usa o app" ou "Não permitir". Mesmo
    # com o serviço em primeiro plano rodando, isso faz vários fabricantes
    # (Xiaomi, Samsung, Motorola etc.) cortarem o GPS assim que o app sai da
    # tela, porque a permissão de segundo plano nunca chegou a ser concedida.
    "ACCESS_BACKGROUND_LOCATION",
    "FOREGROUND_SERVICE",
    "FOREGROUND_SERVICE_LOCATION",  # obrigatória no Android 14+
    "POST_NOTIFICATIONS",           # notificação fixa no Android 13+
    "WAKE_LOCK",
    # Permite o app pedir ao usuário, via diálogo do sistema, para ser
    # excluído da otimização de bateria — outra causa muito comum de
    # rastreio parar sozinho em segundo plano em aparelhos como Xiaomi,
    # Samsung e Motorola. Esta permissão sozinha não desativa a otimização;
    # ela só permite que o app abra o diálogo pedindo a exceção.
    "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
]
linhas = ""
for p in permissoes:
    nome = "android.permission." + p
    if nome not in xml:
        linhas += '    <uses-permission android:name="%s" />\n' % nome
if linhas:
    xml = xml.replace("</manifest>", linhas + "</manifest>")

servico = "com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService"
if servico not in xml:
    tag = (
        '        <service android:name="%s" android:enabled="true" '
        'android:exported="true" android:foregroundServiceType="location" />\n' % servico
    )
    xml = xml.replace("</application>", tag + "    </application>")
manifesto.write_text(xml, encoding="utf-8")

# ---------- build.gradle do app ----------
gradle = pathlib.Path("android/app/build.gradle")
g = gradle.read_text(encoding="utf-8")
numero = os.environ.get("GITHUB_RUN_NUMBER", "1")
g = re.sub(r"versionCode\s+\d+", "versionCode " + numero, g, count=1)
g = re.sub(r'versionName\s+"[^"]*"', 'versionName "1.0.%s"' % numero, g, count=1)

if "everton-debug.keystore" not in g:
    bloco = (
        "android {\n"
        "    signingConfigs {\n"
        "        debug {\n"
        '            storeFile rootProject.file("../everton-debug.keystore")\n'
        '            storePassword "android"\n'
        '            keyAlias "androiddebugkey"\n'
        '            keyPassword "android"\n'
        "        }\n"
        "    }"
    )
    g = re.sub(r"^android\s*\{", lambda m: bloco, g, count=1, flags=re.M)
gradle.write_text(g, encoding="utf-8")

print("Projeto Android ajustado (versão 1.0.%s)" % numero)
