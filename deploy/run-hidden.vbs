' Executa um comando sem nenhuma janela.
' O Agendador de Tarefas com -WindowStyle Hidden nao basta: na sessao interativa
' o processo filho (node, ollama) aloca console proprio e ele aparece. WScript.Shell
' com intWindowStyle=0 nao aloca console nenhum, e nao exige elevacao — ao contrario
' do LogonType S4U.
'
' Uso: wscript.exe run-hidden.vbs "<comando completo>"

If WScript.Arguments.Count < 1 Then
  WScript.Quit 1
End If

Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run WScript.Arguments(0), 0, False
