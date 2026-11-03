# Accès partenaire — OCPV / SIMAgri

## Objectif
Obtenir un canal autorisé et reproductible des observations de prix agricoles ivoiriennes pour le moteur de décision AFE-CI. Le démarrage porte sur le maïs jaune et le soja.

## Organismes et coordonnées publiques vérifiées

### OCPV — Office d'Aide à la Commercialisation des Produits Vivriers
- Site : https://www.ocpv-ci.com/
- Adresse : Abobo PK18, route d'Anyama, Carrefour AGRIPAC, Abidjan
- Téléphones : +225 27 24 39 18 74 / +225 27 24 48 00 27
- Courriels publiés : info@ocpv-ci.com ; direction.ocpv@gmail.com
- Les pages publiques diffusent des prix hebdomadaires par ville et des bulletins. Demander le format d'export et les conditions de réutilisation.

### SIMAgri — INADES-Formation Côte d'Ivoire
- Site : https://www.simagri-ci.info/
- Adresse publiée : Cocody Angré-Djibi, Cité Wedouwel / Soleil 2, villa 78, Abidjan
- Téléphones : +225 07 47 75 09 53 / 01 40 42 21 14
- Courriel publié : simagri@gmail.com
- La plateforme publie des prix agricoles de gros et de détail, des alertes et des bulletins mensuels. Demander les modalités d'accès aux données et leur licence de réutilisation.

## Questions à adresser aux équipes
1. Existe-t-il une API documentée (REST/JSON), un flux périodique ou un export CSV/XLSX automatisable ?
2. Quels produits, marchés et niveaux de prix sont couverts (gros, détail, collecte) ?
3. Les données incluent-elles date d'observation, date de publication, ville/marché, région, unité, devise et méthode de collecte ?
4. Quelle fréquence de mise à jour et quel délai de disponibilité sont garantis ?
5. Quelles sont les conditions d'accès, d'attribution, de conservation, de republication et d'utilisation commerciale ?
6. Peut-on obtenir un échantillon anonymisé, le dictionnaire des champs et un compte de test ?
7. Un interlocuteur technique peut-il être désigné ?

## Courriel prêt à envoyer

**Objet : Demande de partenariat technique — accès autorisé aux données de prix agricoles pour AFE-CI**

Madame, Monsieur,

Nous développons AFE-CI, un outil d'aide à la décision destiné notamment à l'analyse économique des activités avicoles en Côte d'Ivoire. Pour fiabiliser les calculs de coûts d'approvisionnement, nous souhaitons intégrer des observations vérifiables de prix agricoles, en commençant par le maïs jaune et le soja.

Nous sollicitons un échange avec votre équipe afin de connaître les modalités d'accès autorisé à vos données : API documentée, flux de données, export CSV/Excel périodique ou autre dispositif approuvé.

Pour assurer une attribution correcte et éviter toute interprétation erronée, nous souhaiterions disposer, dans la mesure du possible, du produit, du marché ou de la ville, du prix, de l'unité, du niveau de marché (gros/détail), de la date d'observation, de la date de publication et de la référence de la source.

Nous sommes également preneurs de votre dictionnaire de données, d'un échantillon d'export et des conditions de réutilisation et de citation applicables.

Nous ne procéderons à aucune extraction automatisée non autorisée de vos pages. L'intégration sera réalisée uniquement selon le canal et les conditions que vous validerez.

Nous vous remercions par avance pour votre orientation vers le responsable des données ou le service technique compétent.

Cordialement,

L'équipe AFE-CI

## Contrat d'intégration technique
Le flux partenaire devra être transformé en observations normalisées AFE-CI, avec au minimum :
- `id`, `product`, `normalizedProduct`, `kind`
- `value`, `currency`, `unit`
- `country`, `region`, `city`
- `sourceName`, `sourceUrl`, `sourceClass`
- `publishedAt`, `retrievedAt`

Le connecteur existant accepte un endpoint HTTPS renvoyant `{ "source": "...", "observations": [...] }`. Le jeton éventuel reste dans une variable d'environnement serveur. Aucun endpoint public non documenté ne doit être utilisé.

## Périmètre des prix
- OCPV / SIMAgri : matières premières agricoles observées sur marchés, notamment maïs et soja.
- Fournisseurs / provenderies : aliments composés par phase, prix par sac et poids net.
- Couvoirs / fournisseurs avicoles : poussins, pintadeaux et autres sujets, prix par sujet et conditions de livraison.

Les prix des céréales ne doivent jamais être assimilés au prix des aliments composés, des poussins ou des pintadeaux.
