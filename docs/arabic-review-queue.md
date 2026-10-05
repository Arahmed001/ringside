# Arabic review queue: the strings written on 2026-10-04

Every Arabic string on the site is machine-written and **none has been reviewed by a person yet** (2,235 strings, 1,848 names; `npm run i18n:review -- status`). This is the part to read first: the 239 strings added in one day, in the pages people are most likely to meet first. Generated from `i18n/keys.json` against the state before that day's work.

How to review: `npm run i18n:review -- export` builds the offline sheet (`review/arabic-review.html`, not committed) to send to a reviewer; their answers come back as a file for `npm run i18n:review -- import`. See `docs/arabic-review.md`. The decisions to confirm first are in the sheet's questions tab (register, gender wording, Latin abbreviations, numbers, boxing terms).

Plurals show the singular form then the general one. A `{name}` in braces is filled in by the site.


## Ask the data: answers (64)

| English | Arabic |
|---|---|
| KO rate, lowest first | نسبة الضربات القاضية، الأدنى أولًا |
| No upcoming fight is scheduled for {name}. | لا يوجد نزال قادم مجدول لـ{name}. |
| Oldest champions | أكبر الأبطال سنًا |
| The data does not give {what} for {name}. | لا تتضمن البيانات {what} لـ{name}. |
| The data gives no champion's age. | لا تتضمن البيانات عمر أي بطل. |
| The data has no current gym for {name}. | لا تتضمن البيانات صالة تدريب حالية لـ{name}. |
| The data has no current head trainer for {name}. | لا تتضمن البيانات مدربًا رئيسيًا حاليًا لـ{name}. |
| The data has no current manager for {name}. | لا تتضمن البيانات مديرًا حاليًا لـ{name}. |
| The data has no current promoter for {name}. | لا يوجد مروّج حالي لـ{name} في البيانات. |
| The oldest champion is {name}, {age}, who holds {belt}. | أكبر الأبطال سنًا هو {name} ({age} سنة)، حامل {belt}. |
| The youngest champion is {name}, {age}, who holds {belt}. | أصغر الأبطال سنًا هو {name} ({age} سنة)، حامل {belt}. |
| There has been {n} completed card; the latest was {event} on {date}. \| There have been {n} completed cards; the latest was {event} on {date}. | أقيمت فعالية واحدة منتهية؛ وآخرها {event} في {date}. / أقيمت {n} فعالية منتهية؛ وآخرها {event} في {date}. |
| There was {n} completed card in {year}; the latest was {event} on {date}. \| There were {n} completed cards in {year}; the latest was {event} on {date}. | أقيمت فعالية واحدة منتهية في {year}؛ وآخرها {event} في {date}. / أقيمت {n} فعالية منتهية في {year}؛ وآخرها {event} في {date}. |
| Youngest champions | أصغر الأبطال سنًا |
| a height | الطول |
| a pro debut year | سنة بداية الاحتراف |
| a reach | امتداد الذراعين |
| a stance | الوقفة |
| age, oldest first | العمر، الأكبر أولًا |
| age, youngest first | العمر، الأصغر أولًا |
| an age | العمر |
| draws | التعادلات |
| height | الطول |
| height, shortest first | الطول، الأقصر أولًا |
| losses | الهزائم |
| rating, lowest first | التصنيف، الأدنى أولًا |
| times stopped | مرات الإيقاف |
| win rate | نسبة الفوز |
| {name} fights at {division}. | {name} ينافس في {division}. |
| {name} has been stopped {n} time (losses in all: {losses}). \| {name} has been stopped {n} times (losses in all: {losses}). | تعرض {name} للإيقاف مرة واحدة (عدد الهزائم: {losses}). / تعرض {name} للإيقاف {n} مرة (عدد الهزائم: {losses}). |
| {name} has had {n} fights: {record}. | خاض {name} {n} نزالًا: {record}. |
| {name} has never been knocked out or stopped on record. | لم يتعرض {name} للإقصاء أو الإيقاف في سجله. |
| {name} has no completed fights on record. | لا توجد نزالات منتهية مسجّلة لـ{name}. |
| {name} has no nickname on record. | لا يوجد لقب مسجّل لـ{name}. |
| {name} has not fought for a title on record. | لم يخض {name} نزال لقب في سجله. |
| {name} has won {won} of {n} title fight. \| {name} has won {won} of {n} title fights. | فاز {name} في {won} من أصل نزال لقب واحد. / فاز {name} في {won} من أصل {n} نزال لقب. |
| {name} has {kos} knockouts in {wins} wins ({pct}%). | لدى {name} {kos} ضربة قاضية في {wins} انتصارًا ({pct}%). |
| {name} holds no current belt. | لا يحمل {name} أي حزام حاليًا. |
| {name} holds {belts}. | يحمل {name} {belts}. |
| {name} is active and has lost {n} time ({record}). \| {name} is active and has lost {n} times ({record}). | {name} نشط وخسر مرة واحدة ({record}). / {name} نشط وخسر {n} مرة ({record}). |
| {name} is active and unbeaten ({record}). | {name} نشط وغير مهزوم ({record}). |
| {name} is from {country}. | {name} من {country}. |
| {name} is known as “{nickname}”. | يُعرف {name} بلقب «{nickname}». |
| {name} is not on a streak (the longest winning run: {longest}). | {name} ليس في سلسلة حاليًا (أطول سلسلة انتصارات: {longest}). |
| {name} is on a losing streak of {n} (the longest winning run: {longest}). | {name} في سلسلة هزائم من {n} (أطول سلسلة انتصارات: {longest}). |
| {name} is on a winning streak of {n} (the longest winning run: {longest}). | {name} في سلسلة انتصارات من {n} (أطول سلسلة انتصارات: {longest}). |
| {name} is rated {elo}{rank}. | تصنيف {name} هو {elo}{rank}. |
| {name} is retired and unbeaten ({record}). | {name} معتزل وغير مهزوم ({record}). |
| {name} is retired; the record is {record}. | {name} معتزل؛ وسجله {record}. |
| {name} is {age} years old. | عمر {name} {age} سنة. |
| {name} is {cm} cm tall. | طول {name} {cm} سم. |
| {name} trains at {gym}. | يتدرب {name} في {gym}. |
| {name} turned pro in {year}. | احترف {name} في عام {year}. |
| {name}'s head trainer is {trainer}. | المدرب الرئيسي لـ{name} هو {trainer}. |
| {name}'s last fight was on {date}: {result} against {opponent} ({method}). | كان آخر نزال لـ{name} بتاريخ {date}: {result} ضد {opponent} ({method}). |
| {name}'s manager is {manager}. | مدير أعمال {name} هو {manager}. |
| {name}'s next fight is against {opponent} on {date}. | نزال {name} القادم ضد {opponent} بتاريخ {date}. |
| {name}'s promoter is {promoter}. | المروّج لـ{name} هو {promoter}. |
| {name}'s reach is {cm} cm. | امتداد ذراعَي {name} {cm} سم. |
| {name}'s stance is {stance}. | وقفة {name} هي {stance}. |
| {name}'s style is {style}. | أسلوب {name} هو {style}. |
| {name}: {won} wins and {lost} losses by decision. | {name}: {won} انتصارات و{lost} هزائم بالنقاط. |
| {n} champions are left out because the data gives no age for them. | استُبعد {n} من الأبطال لأن البيانات لا تتضمن أعمارهم. |
| {title}: {name} is number {n} ({record}, rated {elo}). | {title}: {name} في المركز {n} ({record}، تصنيف {elo}). |

## Boxing explained (/learn) (42)

| English | Arabic |
|---|---|
| A fight stopped early by an accident, usually a cut from a clash of heads, goes to the scorecards once enough rounds have been fought (usually four, depending on the commission). A technical draw is the same with level cards. | النزال الذي يتوقف مبكرًا بسبب حادث، وغالبًا جرح ناتج عن اصطدام الرأسين، يُحسم بالبطاقات بعد أن تُخاض جولات كافية (أربع جولات عادةً، بحسب الهيئة المنظِّمة). أما التعادل الفني فهو الحالة نفسها حين تتساوى البطاقات. |
| A fighter breaks the rules badly or repeatedly, for example with low blows, and loses on the spot. | يخالف الملاكم القواعد مخالفة جسيمة أو متكررة، كالضربات تحت الحزام، فيخسر النزال فورًا. |
| A fighter is knocked down and cannot get up before the referee counts ten. | يسقط الملاكم أرضًا ولا يستطيع النهوض قبل أن يعدّ الحكم إلى عشرة. |
| A fighter needs five fights on record to be ranked. The win probabilities on fight previews come from these ratings, and the track record page shows how they have done. | يحتاج الملاكم إلى خمسة نزالات مسجّلة ليُدرج في التصنيف. وتأتي احتمالات الفوز في معاينات النزالات من هذه التصنيفات، وتعرض صفحة السجل الحافل أداءها. |
| A fighter's corner pulls them out between rounds. Ringside counts it as a knockout, as most record keepers do. | تسحب زاوية الملاكم ملاكمها بين الجولات. يحتسبها Ringside ضربة قاضية، كما تفعل معظم جهات حفظ السجلات. |
| A record is wins, losses and draws, in that order: {example} is 25 wins, 3 losses and 1 draw. Knockouts are the wins that ended early; Ringside shows them as a count and as a share of wins. A no contest is not in the record. | السجل هو الانتصارات ثم الهزائم ثم حالات التعادل بهذا الترتيب: {example} تعني 25 انتصارًا و3 هزائم وتعادلًا واحدًا. الضربات القاضية هي الانتصارات التي انتهت مبكرًا، ويعرضها Ringside عددًا ونسبةً من الانتصارات. أما النزال الملغى النتيجة فلا يدخل في السجل. |
| All three judges pick the same fighter. | يختار الحكام الثلاثة الملاكم نفسه. |
| An organisation may also name an interim champion while the champion is out, or a super champion for its best fighter. Ringside rebuilds each belt's line of champions from the title fights in the data. | وقد تسمّي الهيئة بطلًا مؤقتًا في غياب البطل، أو بطلًا سوبر لأفضل ملاكميها. ويعيد Ringside بناء سلسلة أبطال كل حزام من نزالات الألقاب الموجودة في البيانات. |
| Belts and champions | الأحزمة والأبطال |
| Boxers fight in {n} divisions, from minimumweight (105 lb) to heavyweight (over 200 lb). Fighters step on the scale the day before the fight, and coming in over the limit is called missing weight. | يتنافس الملاكمون في {n} فئة وزنية، من وزن القش (105 رطل) إلى الوزن الثقيل (فوق 200 رطل). يزن الملاكمون قبل يوم من النزال، وتجاوز الحد المسموح يسمى عدم بلوغ الوزن. |
| Boxing, explained | الملاكمة بالتبسيط |
| Corner retirement (RTD) | انسحاب من الزاوية (RTD) |
| Decision | القرار |
| Disqualification (DQ) | استبعاد (DQ) |
| Each judge scores every round with the 10-point must system: the fighter who won the round gets 10 points and the other gets 9 or fewer. A knockdown usually costs the fighter who went down an extra point, and the referee can take a point for a foul. A round that is exactly level is scored {level}, which is rare. | يمنح كل حكم كل جولة نقاطًا بنظام العشر نقاط: يحصل الفائز بالجولة على 10 نقاط ويحصل الآخر على 9 أو أقل. وغالبًا ما تكلّف الإسقاطة الملاكم الذي سقط نقطة إضافية، ويمكن للحكم خصم نقطة بسبب مخالفة. والجولة المتعادلة تمامًا تُسجَّل {level}، وهذا نادر. |
| Four organisations, the WBA, WBC, IBF and WBO, each name a world champion in every division, so one division can have four champions at once. A fighter who holds more than one of those belts is a unified champion, and one who holds all four is called undisputed. | تسمّي أربع هيئات هي WBA وWBC وIBF وWBO بطلًا للعالم في كل فئة، فيمكن أن يكون في الفئة الواحدة أربعة أبطال في آن واحد. ومن يحمل أكثر من حزام منها بطل موحّد، ومن يحمل الأحزمة الأربعة يسمى بطلًا مطلقًا. |
| How a fight is won | كيف يُحسم النزال |
| How a fight is won and scored, how to read a record, what the weight classes and belts mean, and where Ringside's ratings come from, in plain words. | كيف يُحسم النزال وتُحتسب نقاطه، وكيف تقرأ السجل، وماذا تعني الفئات الوزنية والأحزمة، ومن أين تأتي تصنيفات Ringside، بكلمات بسيطة. |
| How the judges score | كيف يحتسب الحكام النقاط |
| How to read a record | كيف تقرأ السجل |
| If nobody is stopped, three judges score every round and the fight is decided on their cards. | إذا لم يتوقف أحد، يسجّل ثلاثة حكام نقاط كل جولة ويُحسم النزال بحسب بطاقاتهم. |
| Knockout (KO) | ضربة قاضية (KO) |
| Majority decision (MD) | قرار بالأغلبية (MD) |
| New to boxing? | جديد على الملاكمة؟ |
| On this page | في هذه الصفحة |
| Ratings are Elo-style: Ringside's own calculation from results, not an official ranking. Everyone starts at 1,500 and gains or loses points after each fight, more for beating a higher-rated opponent, and a stoppage counts for a little more than a decision. | التصنيفات بنظام شبيه بـElo: حساب خاص بـRingside من النتائج وليس تصنيفًا رسميًا. يبدأ الجميع من 1,500 ويكسبون نقاطًا أو يخسرونها بعد كل نزال، وتزيد النقاط عند الفوز على خصم أعلى تصنيفًا، ويُحتسب التوقف أكثر قليلًا من القرار. |
| See every belt and its champions | شاهد كل حزام وأبطاله |
| See the rankings in every division | شاهد التصنيفات في كل فئة وزنية |
| See the track record | شاهد السجل الحافل |
| Split decision (SD) | قرار منقسم (SD) |
| Technical knockout (TKO) | توقف فني (TKO) |
| The cards do not give either fighter a majority. | لا تمنح البطاقات أيًّا من الملاكمَين أغلبية. |
| The few things this site's numbers take for granted: how a fight is won, how to read a record and what a belt means. | القليل مما تفترض أرقام هذا الموقع أنك تعرفه: كيف يُحسم النزال، وكيف تقرأ السجل، وماذا يعني الحزام. |
| The fight is declared void, for example after an accidental foul early on. It is in neither fighter's record. | يُعلن النزال لاغيًا، مثلًا بعد مخالفة غير متعمدة في وقت مبكر. ولا يدخل في سجل أي من الملاكمَين. |
| The referee, or the ringside doctor, stops the fight because a fighter can no longer defend themselves or is too badly hurt to go on. | يوقف الحكم أو طبيب الحلبة النزال لأن الملاكم لم يعد قادرًا على الدفاع عن نفسه أو لأنه مصاب إصابة بالغة تمنعه من المتابعة. |
| The three cards are added up, and how they agree gives the result: | تُجمع البطاقات الثلاث، ويحدد اتفاقها النتيجة: |
| Two judges pick one fighter and the third picks the other. | يختار حكمان ملاكمًا ويختار الثالث الملاكم الآخر. |
| Two judges pick one fighter and the third scores it a draw. | يختار حكمان ملاكمًا ويسجّل الثالث النزال تعادلًا. |
| Unanimous decision (UD) | قرار بالإجماع (UD) |
| Weight classes | الفئات الوزنية |
| When Ringside does not hold a fighter's early fights, the record on the page is the career total from the data supplier and the page says so; the fight list and the rates are then built only from the fights we hold. | حين لا تتوفر لدى Ringside نزالات ملاكم الأولى، يكون السجل في الصفحة هو إجمالي مسيرته من مزوّد البيانات وتذكر الصفحة ذلك؛ وتُبنى قائمة النزالات والنسب حينها من النزالات المتوفرة لدينا فقط. |
| Where Ringside's ratings come from | من أين تأتي تصنيفات Ringside |

## Fighter page (38)

| English | Arabic |
|---|---|
| #{rank} {body} | المركز {rank} في {body} |
| Best win | أفضل فوز |
| Biggest upset | أكبر مفاجأة |
| Busiest year | أكثر سنة نزالًا |
| By the numbers | بالأرقام |
| Career highlights | أبرز محطات المسيرة |
| Counted from every fight we hold | محسوبة من كل نزال لدينا |
| Ended in {date} | انتهت في {date} |
| Fought in | بلدان النزالات |
| Last fight \| Last {n} fights | آخر نزال / آخر {n} نزال |
| Last fought today | آخر نزال اليوم |
| Last fought {n} day ago \| Last fought {n} days ago | آخر نزال قبل يوم واحد / آخر نزال قبل {n} يوم |
| Last fought {n} month ago \| Last fought {n} months ago | آخر نزال قبل شهر واحد / آخر نزال قبل {n} شهر |
| Last fought {n} year ago \| Last fought {n} years ago | آخر نزال قبل سنة واحدة / آخر نزال قبل {n} سنة |
| Longest layoff | أطول غياب عن الحلبة |
| Most-fought venue | المكان الأكثر نزالًا |
| Quick wins | انتصارات سريعة |
| Rated {n} points higher going in | تصنيفه أعلى بـ {n} نقطة قبل النزال |
| Rated {rating} going in | تصنيفه {rating} قبل النزال |
| Rounds boxed | عدد الجولات |
| Still going | ما زالت مستمرة |
| Stopped an opponent in three rounds or fewer | انتصار بالإيقاف في ثلاث جولات أو أقل |
| The best of the fights we hold | أفضل ما في النزالات المتوفرة لدينا |
| The record and the knockouts are the career totals from the data supplier. Ringside holds {held} of those {total} fights, so the fight list, rating and rates on this page are built from those {held} only. | السجل والضربات القاضية هما الإجمالي المهني من مزوّد البيانات. لدى Ringside {held} من أصل {total} نزالًا، لذا تُبنى قائمة النزالات والتصنيف والنسب في هذه الصفحة من هذه الـ{held} فقط. |
| The record is the career total from the data supplier. Ringside holds {held} of those {total} fights, so the fight list, knockouts, rating and rates on this page are built from those {held} only. | السجل هو إجمالي مسيرة الملاكم كما يذكره مزوّد البيانات. لدى رينغسايد {held} من أصل {total} نزالًا، لذا فإن قائمة النزالات والضربات القاضية والتصنيف والنسب في هذه الصفحة مبنية على هذه الـ{held} فقط. |
| The {body} list as relayed by Boxing Data API | قائمة {body} كما تنقلها Boxing Data API |
| Times stopped | مرات التوقف |
| Went the distance | نزالات بلغت المسافة كاملة |
| Worked out from the {held} fights Ringside holds, not the whole career. | محسوبة من {held} نزالًا تتوفر لدى Ringside، وليس من المسيرة كاملة. |
| then <r>{record}</r>, rated {rating} | حينها <r>{record}</r> بتصنيف {rating} |
| then on debut, rated {rating} | حينها في أول نزال احترافي، بتصنيف {rating} |
| then rated {rating} | حينها بتصنيف {rating} |
| {body} champion | بطل {body} |
| {body} interim champion | بطل {body} المؤقت |
| {body} regular champion | بطل {body} العادي |
| {n} fight in all \| {n} fights in all | {n} نزال في المجموع / {n} نزال في المجموع |
| {n} of {of} fights | {n} من أصل {of} نزالًا |
| {n} straight win \| {n} straight wins | انتصار واحد متتالي / {n} انتصار متتالي |

## Ask the data and scouting text (fallback wording) (25)

| English | Arabic |
|---|---|
| Draws ≤ {n} | التعادلات: {n} فأقل |
| Draws ≥ {n} | التعادلات: {n} فأكثر |
| Fights ≤ {n} | النزالات: {n} فأقل |
| Fights ≥ {n} | النزالات: {n} فأكثر |
| Former champions | أبطال سابقون |
| Has held a belt | سبق له حمل حزام |
| Height ≤ {n}cm | الطول: {n} سم فأقل |
| Height ≥ {n}cm | الطول: {n} سم فأكثر |
| KOs ≤ {n} | الضربات القاضية: {n} فأقل |
| Last fought by {date} | آخر نزال حتى {date} |
| Last fought since {date} | آخر نزال منذ {date} |
| Losing record | سجل هزائم |
| Losing streak ≥ {n} | سلسلة هزائم: {n} فأكثر |
| Losses ≤ {n} | الهزائم: {n} فأقل |
| Never stopped | لم يُوقف قط |
| No draws | بلا تعادلات |
| Rating ≤ {n} | التصنيف: {n} فأقل |
| Rating ≥ {n} | التصنيف: {n} فأكثر |
| Reach ≤ {n}cm | امتداد الذراعين: {n} سم فأقل |
| Stopped ≤ {n} times | مرات الإيقاف: {n} فأقل |
| Stopped ≥ {n} times | مرات الإيقاف: {n} فأكثر |
| Unbeaten in last {n} | لم يخسر في آخر {n} |
| Win streak ≥ {n} | سلسلة انتصارات: {n} فأكثر |
| Winning record | سجل فوز |
| Wins ≤ {n} | الانتصارات: {n} فأقل |

## Country pages (21)

| English | Arabic |
|---|---|
| All belts | كل الأحزمة |
| All events | كل الفعاليات |
| All {n} fighters | كل الملاكمين ({n}) |
| Belts held by a fighter from {country} | أحزمة بحوزة ملاكم من {country} |
| Best rated | الأعلى تصنيفًا |
| Boxers from {country} | ملاكمون من {country} |
| Boxing by country | الملاكمة حسب البلد |
| Coming fights | النزالات القادمة |
| Events held here | فعاليات أُقيمت هنا |
| Every country with a boxer in the Ringside database: its best fighters, current champions, coming fights and the events held there. | كل بلد فيه ملاكم في قاعدة بيانات Ringside: أفضل ملاكميه وأبطاله الحاليون ونزالاته القادمة والفعاليات التي أُقيمت فيه. |
| No fighters yet. | لا يوجد ملاكمون بعد. |
| Recent cards in {country} | أحدث النزالات في {country} |
| The best-rated boxers from {country}: current champions, coming fights and events held there. {n} fighters in the Ringside database. | الملاكمون الأعلى تصنيفًا من {country}: الأبطال الحاليون والنزالات القادمة والفعاليات التي أُقيمت هناك. {n} ملاكمًا في قاعدة بيانات Ringside. |
| Top fighters | أفضل الملاكمين |
| Where the fighters are from | من أين يأتي الملاكمون |
| belts held now | أحزمة بحوزتهم الآن |
| on record | في السجلات |
| still fighting | ما زالوا يقاتلون |
| who have fought | خاضوا نزالًا |
| {fighters} · {active} active | {fighters} · {active} نشطًا |
| {n} countries, the one with the most fighters first. Open one for its best fighters, its champions and its coming fights. | {n} بلدًا، يأتي أولًا البلد الأكثر ملاكمين. افتح أي بلد لترى أفضل ملاكميه وأبطاله ونزالاته القادمة. |

## Official rankings (WBA, WBC, IBF, WBO) (10)

| English | Arabic |
|---|---|
| International Boxing Federation | الاتحاد الدولي للملاكمة (IBF) |
| Official list | القائمة الرسمية |
| The {body} list as it stood on {date}. | قائمة {body} كما كانت في {date}. |
| The {body} list. | قائمة {body}. |
| These are the body's own standings, relayed by Boxing Data API from BoxingScene. They are not Ringside's ranking, and a fighter shown without a link or numbers is not in Ringside's data yet. | هذه ترتيبات الهيئة نفسها، تنقلها Boxing Data API عن BoxingScene. وهي ليست تصنيف Ringside، والملاكم الظاهر بلا رابط أو أرقام ليس في بيانات Ringside بعد. |
| This list has no ranked contenders. | لا يوجد في هذه القائمة متنافسون مصنّفون. |
| World Boxing Association | الرابطة العالمية للملاكمة (WBA) |
| World Boxing Council | المجلس العالمي للملاكمة (WBC) |
| World Boxing Organization | المنظمة العالمية للملاكمة (WBO) |
| {body} contenders | متنافسو {body} |

## Other (7)

| English | Arabic |
|---|---|
| Pages of bouts refereed | صفحات النزالات التي أدارها |
| Pages of bouts scored | صفحات النزالات التي حكّم فيها |
| Pages of clients | صفحات العملاء |
| Pages of events | صفحات الفعاليات |
| Pages of fighters | صفحات الملاكمين |
| Pages of title fights | صفحات نزالات الألقاب |
| Top 12 of {n} by rating; everyone is in the table below | أعلى 12 من {n} حسب التصنيف؛ الجميع في الجدول أدناه |

## Fighters list and filters (6)

| English | Arabic |
|---|---|
| Active and retired | النشطون والمعتزلون |
| All countries | كل البلدان |
| Any stance | أي وقفة |
| Clear filters | مسح التصفية |
| Latest fight | آخر نزال |
| Ordered by knockouts as a share of wins. Fighters with fewer than {min} wins, or whose career is held only in part, come last. | الترتيب بنسبة الضربات القاضية من الانتصارات. يأتي في النهاية من حقق أقل من {min} انتصارات، ومن لا نملك من مسيرته إلا جزءًا. |

## Rankings pages (5)

| English | Arabic |
|---|---|
| Find a fighter in this division | ابحث عن ملاكم في هذا الوزن |
| No fighter in this division has the five fights on record that a ranking needs yet. | لا يملك أي ملاكم في هذه الفئة النزالات الخمسة المسجّلة التي يتطلبها التصنيف حتى الآن. |
| Ringside rating | تصنيف Ringside |
| These rankings count only the fights Ringside holds. Most fighters here have only their most recent fights on record so far, so few reach the five fights a ranking needs; more qualify as the history is added. | تعتمد هذه التصنيفات على النزالات التي يملكها رينغسايد فقط. لا يتوفر لمعظم الملاكمين هنا حتى الآن سوى أحدث نزالاتهم، لذا يبلغ القليلون منهم النزالات الخمسة التي يتطلبها التصنيف؛ ويزداد عدد المؤهلين كلما أُضيف المزيد من التاريخ. |
| Which ranking | أي تصنيف |

## Matchup page (4)

| English | Arabic |
|---|---|
| Held in part: an opponent missing here may be a fight Ringside does not hold. | المسيرة محفوظة جزئيًا: قد يكون الخصم الغائب هنا نزالًا لا يملكه رينغسايد. |
| Model win probability: {a}% to {b}% | احتمال الفوز بحسب النموذج: {a}% مقابل {b}% |
| Win probability, how the fight likely ends and what drives the number for {a} against {b}. | احتمال الفوز وكيف يُرجَّح أن ينتهي النزال وما الذي يحرّك الرقم بين {a} و{b}. |
| {n} more opponent in common \| {n} more opponents in common | خصم مشترك آخر واحد / {n} خصم مشترك آخر |

## Data and coverage page (4)

| English | Arabic |
|---|---|
| Career record stated by the data supplier | السجل المهني كما يذكره مزوّد البيانات |
| Fighters whose fights Ringside holds only in part | ملاكمون لا يملك رينغسايد إلا جزءًا من نزالاتهم |
| lower is better; their pages say so | الأقل هو الأفضل؛ وصفحاتهم تذكر ذلك |
| shown, labelled, when Ringside holds fewer fights than that | يُعرض مع تنويه عندما يملك رينغسايد نزالات أقل منه |

## Share button (3)

| English | Arabic |
|---|---|
| Couldn’t copy the link | تعذّر نسخ الرابط |
| Link copied | تم نسخ الرابط |
| Share | مشاركة |

## Bout page (2)

| English | Arabic |
|---|---|
| As given by the data supplier, in its order. It does not say which judge gave which score, or which corner each number belongs to. | كما قدّمها مزوّد البيانات وبترتيبه. لا يذكر أي حكم أعطى أي نتيجة، ولا لأي ركن تعود كل نتيجة. |
| Judges' scores | نتائج الحكام |

## Navigation (2)

| English | Arabic |
|---|---|
| Boxing explained | الملاكمة بالتبسيط |
| Countries | البلدان |

## Ask the data: results (2)

| English | Arabic |
|---|---|
| These lists and counts cover all of boxing history and cannot be cut to a stretch of years such as “since 2018” or “this decade”. Try one year, such as “best fight of 2025” or “knockouts in 2025”. | هذه القوائم والأعداد تغطي تاريخ الملاكمة كله ولا يمكن تقييدها بفترة من السنوات مثل «منذ 2018» أو «هذا العقد». جرّب سنة واحدة، مثل «أفضل نزال في عام 2025». |
| These lists can be narrowed to men or women and one weight division, but not to other groups of fighters or to a region. Try a search such as “southpaw welterweights with 10+ KOs” or “most knockouts among women”. | يمكن تضييق هذه القوائم إلى الرجال أو النساء ووزن واحد، لكن ليس إلى فئات أخرى من الملاكمين أو إلى منطقة. جرّب بحثًا مثل «ملاكمون من اليابان» أو «أكثر ضربات قاضية بين النساء». |

## 404 page (1)

| English | Arabic |
|---|---|
| Did you mean one of these fighters? | هل تقصد أحد هؤلاء الملاكمين؟ |

## Titles (1)

| English | Arabic |
|---|---|
| Jump to a division | انتقل إلى فئة وزنية |

## All-time lists (1)

| English | Arabic |
|---|---|
| Jump to a section | انتقل إلى قسم |

## Money (1)

| English | Arabic |
|---|---|
| No financial figures are loaded yet. They arrive with a data feed that carries them, or from the research pipeline (see <c>docs/research.md</c>). | لم تُحمَّل أرقام مالية بعد. تصل مع مصدر بيانات يتضمنها، أو من خط البحث (انظر <c>docs/research.md</c>). |
