# Linting XML des fichiers Telepac

Un test préliminaire pour vérifier que les fichiers de fixtures sont correct est d'utiliser [xmllint] pour valider leur contenu :

```bash
# 2023v2
xmllint --noout --schema test/fixtures/telepac-2023v2.xsd test/fixtures/telepac-single-2023v2.xml
xmllint --noout --schema test/fixtures/telepac-2023v2.xsd test/fixtures/telepac-multi-2024v3.xml

# 2024v3
xmllint --noout --schema test/fixtures/telepac-2024v3.xsd test/fixtures/telepac-single-2024v3.xml
xmllint --noout --schema test/fixtures/telepac-2024v3.xsd test/fixtures/telepac-multi-2024v3.xml

# 2024v4
xmllint --noout --schema test/fixtures/telepac-2024v4.xsd test/fixtures/telepac-single-2024v4.xml
xmllint --noout --schema test/fixtures/telepac-2024v4.xsd test/fixtures/telepac-multi-2024v4.xml
```

[xmllint]: https://gnome.pages.gitlab.gnome.org/libxml2/xmllint.html
