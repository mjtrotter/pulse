// Plain-language guides for the lab-derived indices, biological age, heart risk and body measurements. explain.js
// adds the live parts (your value on the zone ladder, the formula worked with your own numbers, your draws).
// Cut-offs and category names here must match the band logic in analytics/labs.js, body.js and riskctx.js.
export const LABGUIDE = {
  // ---------------------------------------------------------------- insulin and blood sugar
  homa_ir: {
    what: "HOMA-IR estimates how hard your body has to work to keep your fasting blood sugar normal. It combines fasting glucose with fasting insulin: if your glucose is normal only because your pancreas is putting out a lot of insulin, the number is high. That pattern, <b>insulin resistance</b>, usually comes years before blood sugar itself rises, which is why it is worth following.",
    read: "Under 1.0 is <b>optimal insulin sensitivity</b>, 1.0 to under 2.0 is <b>normal</b>, 2.0 to under 2.9 is <b>early insulin resistance</b>, and 2.9 or more is <b>insulin resistance</b>. Cut-offs vary between populations, so where you sit and which way it moves between draws matter more than the exact line. Insulin tests differ between labs, so compare draws from the same lab where you can.",
    moves: "Lower (better): losing fat around the middle, regular aerobic exercise and strength training, enough sleep, and fewer sugary drinks and refined carbohydrates. Higher: weight gain, inactivity, short sleep, illness, steroid medicines, and a sample that was not truly fasting (even a milky coffee raises insulin).",
    act: "In the insulin-resistance range, especially with a fasting glucose of 100 mg/dL or more or an HbA1c of 5.7% or more, it is worth raising at your next appointment. It is not a diagnosis of diabetes.",
    caveat: "Only meaningful on a true fasting sample (8–12 hours, water only). Insulin varies a good deal from one morning to the next, so one result is a rough estimate, and it means little if you inject insulin.",
  },
  homa_b: {
    what: "HOMA-%B estimates how much insulin the beta cells of your pancreas are producing for your fasting glucose, as a percentage of a normal reference set at 100%. It comes from the same model and the same two fasting results as HOMA-IR.",
    read: "There is no validated healthy range, so Pulse describes it rather than colouring it; <b>about 100% is typical</b>. A high value usually means the pancreas is working overtime to make up for insulin resistance. A falling value, particularly with rising glucose, can mean the beta cells are starting to keep up less well. Read it beside HOMA-IR and glucose, and watch its direction across draws.",
    moves: "Higher: insulin resistance (the pancreas compensates), weight gain, a sample that was not fasting. Lower: better insulin sensitivity (less work needed, a good change), but also a pancreas that is tiring, as in developing type 2 diabetes. Because each direction can mean more than one thing, it is only useful next to glucose and HOMA-IR.",
    act: "A falling value together with a rising fasting glucose or HbA1c is worth mentioning to your clinician.",
    caveat: "Very sensitive to small errors in glucose: when fasting glucose is low (60s or low 70s mg/dL) it can jump to implausible numbers. It is a model estimate, not a direct measurement.",
  },
  quicki: {
    what: "QUICKI (quantitative insulin sensitivity check index) uses the same fasting glucose and insulin as HOMA-IR, but on a log scale, which helped it agree with the gold-standard glucose clamp test in its original study. It runs the opposite way: <b>higher means more sensitive</b> to insulin.",
    read: "0.357 or more is <b>typical of lean, healthy adults</b>; 0.30 to under 0.357 is <b>reduced insulin sensitivity</b>; under 0.30 is <b>low</b>, close to the averages of the groups with diabetes or obesity in the original study. Because of the log scale it moves in small steps, and a difference in the second decimal place can come from ordinary morning-to-morning swings in insulin, so look for a direction across several draws. Like HOMA-IR, its cut-offs depend on the population.",
    moves: "The same things as HOMA-IR, in reverse: weight loss, exercise and good sleep raise it; weight gain, inactivity, illness and a non-fasting sample lower it.",
    act: "Under 0.30, or with HOMA-IR also in the insulin-resistance range: mention it with your glucose and HbA1c at your next appointment.",
    caveat: "It is built from exactly the same two results as HOMA-IR, so the two agreeing is one piece of evidence, not two. Fasting samples only.",
  },
  mcauley: {
    what: "The McAuley index estimates insulin sensitivity from fasting insulin and fasting triglycerides instead of glucose. It was built against the glucose clamp in adults whose blood sugar was still normal, to find insulin resistance before glucose rises. Higher means more sensitive.",
    read: "It has a single cut-off: above 5.8 is <b>insulin sensitive</b>, and 5.8 or below is <b>insulin resistant</b>, the line that best matched the clamp in the original study. Because it leans on triglycerides, it will not always agree with HOMA-IR and QUICKI; when they disagree, follow the direction each one takes over several draws rather than picking a favourite.",
    moves: "Higher (better): weight loss, regular exercise, less alcohol and fewer refined carbohydrates (all of which lower triglycerides), and oily fish. Lower: weight gain, a diet high in sugar or alcohol, poorly controlled blood sugar, and a sample that was not fasting.",
    act: "5.8 or below with the other insulin measures pointing the same way: raise it at your next appointment.",
    caveat: "Alcohol or a rich meal the evening before can raise next-morning triglycerides and pull this number down.",
  },
  tyg: {
    what: "The TyG (triglyceride–glucose) index combines two inexpensive fasting results, triglycerides and glucose, on a log scale. Both rise when the body handles insulin poorly, so together they stand in for insulin resistance when insulin itself has not been measured.",
    read: "Under 8.5 is <b>lower insulin-resistance risk</b>, 8.5 to under 8.8 is <b>borderline</b>, and 8.8 or more is <b>higher insulin-resistance risk</b>. Published thresholds sit in that 8.5–8.8 band and differ between populations. In large cohorts a higher TyG also went with more type 2 diabetes and heart disease later. Because of the log scale the index moves in small steps, so look at its direction across fasting draws.",
    moves: "Everything that moves triglycerides and fasting glucose: weight, alcohol, refined carbohydrates and sugar, exercise, sleep, and whether you were truly fasting.",
    act: "8.8 or more on more than one fasting draw, especially with a fasting glucose of 100 mg/dL or more: mention it at your next appointment.",
    caveat: "Fasting samples only; triglycerides rise sharply for hours after a meal.",
  },
  // ---------------------------------------------------------------- cholesterol and blood fats
  tg_hdl: {
    what: "Triglycerides divided by HDL (the \"good\") cholesterol. High triglycerides with low HDL is the typical blood-fat pattern of insulin resistance, and it tends to come with smaller, denser LDL particles that get into artery walls more easily.",
    read: "With both results in mg/dL: under 2 is <b>favourable</b>, 2 to under 3.5 is <b>intermediate</b>, and 3.5 or more <b>suggests insulin resistance</b>, the line that picked out insulin-resistant adults in the original study of overweight people. The same ratio worked out in mmol/L is a smaller number and these cut-offs do not apply to it.",
    moves: "Lower (better): weight loss, regular exercise (which also raises HDL), less alcohol and sugar, fewer refined carbohydrates, oily fish, not smoking. Higher: weight gain, alcohol, a high-sugar diet, smoking, poorly controlled blood sugar, a sample that was not fasting.",
    act: "3.5 or more on repeat draws is a reason to look at your glucose, HbA1c and waist together, and to discuss them at your next appointment.",
    caveat: "It works less well in some groups, including people of African ancestry, who often have normal triglycerides even when insulin resistant.",
  },
  aip: {
    what: "The atherogenic index of plasma is the triglyceride-to-HDL ratio worked out in mmol/L and put on a log scale. It was proposed as a marker of LDL particle size: the higher it is, the more of your LDL tends to be the small, dense kind.",
    read: "Under 0.11 is <b>low</b>, 0.11 to 0.21 is <b>intermediate</b>, and above 0.21 is <b>high</b>. It carries the same information as the triglyceride/HDL ratio, so the two move together; it is not an extra, independent warning.",
    moves: "The same things as the triglyceride/HDL ratio: weight, exercise, alcohol, sugar and refined carbohydrates, smoking, and fasting before the draw.",
    act: "High on repeat draws: worth discussing together with your LDL, non-HDL cholesterol and, if you have it, ApoB.",
    caveat: "The bands come mainly from one research group's work and are less widely validated than standard cholesterol targets.",
  },
  remnant: {
    what: "Remnant cholesterol is the cholesterol carried in triglyceride-rich particles, the leftovers of fat-carrying particles after they have unloaded some of their fat. It is the part of your total cholesterol that is neither HDL nor LDL. These particles can enter artery walls like LDL does, and in large Danish studies higher levels were linked to heart disease on their own.",
    read: "Under 24 mg/dL is <b>typical</b>, 24 to under 39 is <b>elevated</b>, and 39 or more is <b>high</b>. It follows triglycerides closely, so it runs higher after meals and with insulin resistance. Compare fasting draws with fasting draws and look at the trend.",
    moves: "Lower: less alcohol, sugar and refined carbohydrates, weight loss, exercise, and better blood-sugar control. Higher: the opposite, and a sample taken after eating.",
    act: "High on repeat draws, especially with high triglycerides: discuss it at your next appointment.",
    caveat: "Most labs calculate LDL from total cholesterol, HDL and triglycerides rather than measuring it. When they do, this number is largely a restatement of your triglycerides and adds little beyond them.",
  },
  nonhdl: {
    what: "Non-HDL cholesterol is your total cholesterol minus HDL: the cholesterol in every particle that can build up in artery walls (LDL plus the triglyceride-rich particles). Guidelines treat it as at least as useful a target as LDL, and it is accurate whether or not you fasted.",
    read: "Under 130 mg/dL is <b>at goal</b>, 130 to under 160 is <b>above optimal</b>, and 160 or more is <b>high</b>. These are general targets; with heart disease, diabetes or a high PREVENT risk your clinician may aim lower. Cholesterol varies by several percent between draws even when nothing has changed, so look for a consistent direction.",
    moves: "Lower: less saturated fat, more fibre, weight loss, exercise, and cholesterol-lowering medicines. Higher: diets high in saturated fat, weight gain, an underactive thyroid, some medicines, and inheritance (some families run high whatever they eat).",
    act: "In the high band on repeat draws, discuss it with your clinician together with your PREVENT risk, which is how guidelines decide whether treatment makes sense. An LDL of 190 mg/dL or more can mean an inherited cholesterol condition: raise it promptly, as close relatives may need testing too.",
    caveat: "It measures how much cholesterol the particles carry, not how many particles there are. ApoB counts the particles directly and is the better guide when the two disagree.",
  },
  castelli1: {
    what: "Total cholesterol divided by HDL. It weighs all the cholesterol in your blood against the HDL that goes with lower risk, and in the Framingham Heart Study it predicted heart attacks better than any single cholesterol number.",
    read: "Under 3.5 is <b>lower risk</b>, 3.5 to under 5.0 is <b>average</b>, and 5.0 or more is <b>higher risk</b>. A high HDL can make the ratio look good even when LDL is high, so read it beside your LDL or non-HDL cholesterol rather than on its own.",
    moves: "Lower (better): anything that lowers LDL or raises HDL, such as regular exercise, weight loss, not smoking, less saturated fat, and cholesterol medicines. Higher: weight gain, smoking, inactivity and a diet high in sugar or saturated fat.",
    caveat: "Ratios are context. Treatment decisions use your LDL or non-HDL cholesterol and your overall risk (PREVENT), not the ratio.",
  },
  castelli2: {
    what: "LDL cholesterol divided by HDL: the main cholesterol carried toward artery walls, weighed against the cholesterol linked with lower risk.",
    read: "Under 2.5 is <b>lower risk</b>, 2.5 to under 3.0 is <b>average</b>, and 3.0 or more is <b>higher risk</b>. LDL cholesterol measures how much cholesterol the LDL particles carry, not how many particles there are. With high triglycerides or insulin resistance each particle carries less, so the ratio can look fine while the particle count is high. An ApoB test settles that, and Pulse flags the mismatch when you have one on file.",
    moves: "The same things as total cholesterol/HDL: exercise, weight, smoking, saturated fat and cholesterol medicines.",
    caveat: "Most labs calculate LDL rather than measure it, and the calculation is least accurate when triglycerides are high or LDL is very low.",
  },
  mets_ir: {
    what: "METS-IR is an insulin-resistance score built from fasting glucose, triglycerides, HDL cholesterol and your BMI. Adding body size to the blood results helped it track the gold-standard glucose clamp test in the Mexican cohort where it was developed.",
    read: "It has one cut-off: under 50.39 is <b>below the insulin-resistance cut-off</b>, and 50.39 or more is <b>above</b> it. In the same work, higher values also predicted type 2 diabetes later. Because BMI is inside it, a change in weight moves it even when your blood results stay the same.",
    moves: "Your weight (through BMI), plus everything that moves triglycerides, glucose and HDL: exercise, alcohol, sugar and refined carbohydrates, sleep, and fasting before the draw.",
    act: "Above the cut-off with other signs of insulin resistance, such as a raised fasting glucose or HbA1c or a large waist: mention it at your next appointment.",
    caveat: "It inherits BMI's blind spots: a muscular person scores higher than their metabolism deserves.",
  },
  // ---------------------------------------------------------------- inflammation
  hscrp: {
    what: "C-reactive protein is made by the liver whenever there is inflammation anywhere in the body. The high-sensitivity test measures the low levels that reflect slow, background inflammation, which is part of how plaque builds up in arteries and becomes unstable.",
    read: "From the AHA/CDC statement: under 1 mg/L is <b>lower relative risk</b>, 1 to 3 is <b>average</b>, and above 3 up to 10 is <b>higher</b>. Above 10 usually means an infection, injury or flare, so it says nothing about heart risk and should be <b>retested</b> once you are well. Because CRP jumps with any cold, the advice is to average two tests about two weeks apart. A level of 2 or more that persists counts as a risk-enhancing factor in the cholesterol guideline.",
    moves: "Higher: infections (even a cold), injuries, dental problems, a very hard workout in the day or two before, excess body fat, smoking, poor sleep, chronic inflammatory conditions, and hormone therapy taken by mouth. Lower: weight loss, regular moderate exercise, stopping smoking, a Mediterranean-style diet, and statins.",
    act: "Above 10 with no obvious reason, or still high on a retest: tell your clinician. A persistent 2 or more is worth mentioning when you discuss cholesterol and heart risk.",
    caveat: "A single result is a snapshot of a number that swings from week to week. It shows that inflammation is present, not where it comes from.",
  },
  // ---------------------------------------------------------------- kidneys
  egfr_cr: {
    what: "eGFR estimates how much blood your kidneys filter each minute, scaled to an average body size (mL/min/1.73m²). This version uses creatinine, a waste product from muscle that healthy kidneys clear, together with your age and sex, in the 2021 CKD-EPI equation, which no longer uses race. Pulse calculates it itself, so it can differ from the eGFR your lab printed with an older formula.",
    read: "90 or more is <b>normal</b>. 60–89 is <b>mildly decreased</b>: common with age, and not kidney disease on its own unless there are other signs of kidney damage such as protein in the urine. Under 60 is <b>reduced</b>, and counts as chronic kidney disease only if it stays below 60 for three months or more. Kidney function drifts down slowly with age, so a steady value from year to year is reassuring; a drop into a lower band together with a fall of about a quarter from your usual is the kind of change that matters. A urine albumin test (UACR) adds the other half of the picture.",
    moves: "Because creatinine comes from muscle, a lot of muscle, a large meat meal in the hours before the draw, creatine supplements, dehydration and very hard exercise can make eGFR look lower than your kidneys really are, and low muscle mass can make it look higher. Real change comes from blood pressure, diabetes, some medicines (including regular use of anti-inflammatory painkillers) and age.",
    act: "Under 60 on two tests at least three months apart, a fall of about a quarter from your usual, or any value under 30: talk to your clinician. With high blood pressure or diabetes, ask whether you are due a urine albumin test.",
    caveat: "Least accurate in very muscular or very frail people and at extremes of body size. A cystatin C test gives an independent check that does not depend on muscle.",
  },
  egfr_cys: {
    what: "The same filtering estimate, calculated from cystatin C instead of creatinine. Cystatin C is a small protein made by nearly all cells at a steady rate, so unlike creatinine it barely depends on muscle mass or diet. This equation never used race, so it was kept unchanged in 2021.",
    read: "The bands are the same: 90 or more is <b>normal</b>, 60–89 <b>mildly decreased</b>, and under 60 <b>reduced</b> (chronic kidney disease only if it lasts three months or more). It is especially useful when creatinine may mislead: very muscular or very slight people, older adults, or a borderline creatinine result. In large studies the cystatin C version predicted heart disease and death more strongly than the creatinine version.",
    moves: "Real changes in kidney function, and also some things that are not about the kidneys: an overactive thyroid, steroid medicines, smoking, inflammation and excess body fat tend to raise cystatin C (lowering eGFR); an underactive thyroid lowers it.",
    act: "Under 60 on two tests at least three months apart, or a clear fall from your usual: talk to your clinician.",
    caveat: "Not every lab offers it, and results from different labs are not always interchangeable, so compare draws from the same lab where you can.",
  },
  egfr_crcys: {
    what: "The combined equation uses both creatinine and cystatin C, so each marker's blind spots partly cancel out. In the 2021 studies it was the most accurate of the three race-free equations, and kidney guidelines (KDIGO 2024) prefer it when both results are available.",
    read: "The bands are the same: 90 or more is <b>normal</b>, 60–89 <b>mildly decreased</b>, and under 60 <b>reduced</b> (chronic kidney disease only if it lasts three months or more). When you have this one, treat it as your main eGFR and the single-marker versions as supporting. If the creatinine and cystatin C versions disagree by a lot, the combined number is the better guide, and the gap itself is worth mentioning.",
    moves: "Anything that moves either marker: muscle, recent meat and creatine supplements for creatinine; thyroid, steroids and inflammation for cystatin C; and real changes in kidney function from blood pressure, diabetes and age.",
    act: "Under 60 on two tests at least three months apart, a fall of about a quarter from your usual, or any value under 30: talk to your clinician.",
  },
  // ---------------------------------------------------------------- liver scarring
  fib4: {
    what: "FIB-4 estimates the chance of advanced scarring (fibrosis) in the liver from four routine numbers: your age, the liver enzymes AST and ALT, and your platelet count. As the liver scars, AST tends to rise relative to ALT and platelets fall, and age is included because scarring builds over decades. It is the recommended first check for people at risk of fatty liver disease (MASLD), such as those with type 2 diabetes, excess weight around the middle or high triglycerides.",
    read: "Under 1.3 (under 2.0 if you are 65 or older) is <b>low probability of advanced fibrosis</b>, and a low result is good at ruling it out. Above 2.67 is <b>high probability of advanced fibrosis</b>. In between is <b>indeterminate</b>: the score cannot decide, and the usual next step is a liver stiffness scan (such as FibroScan) or a specialised blood test. The low cut-off rises to 2.0 at 65 because age alone pushes the score up. These cut-offs are the ones validated for fatty liver; the original hepatitis C and HIV study used 1.45 and 3.25.",
    moves: "Age (it creeps up every birthday even if nothing else changes); anything that raises AST, such as alcohol, a hard workout or muscle strain in the days before the draw, or some medicines; and a low platelet count for any reason. Real improvement in fatty liver comes from weight loss, less alcohol and better blood-sugar control.",
    act: "Indeterminate or high, particularly on a repeat test: ask your clinician whether a liver stiffness scan or referral makes sense.",
    caveat: "Less reliable under about 35, and it still over-calls in older people despite the adjusted cut-off. It is not meant for times when the liver is acutely inflamed and enzymes are very high.",
  },
  nafld_fs: {
    what: "The NAFLD fibrosis score estimates the chance of advanced liver scarring in people with fatty liver. It combines age, BMI, whether you have raised fasting glucose (100 mg/dL or more) or diabetes, the balance of the liver enzymes AST and ALT, your platelet count, and albumin, a protein the liver makes. NAFLD is the older name for what is now called MASLD.",
    read: "Below −1.455 is <b>low probability of advanced fibrosis</b> (stages F0–F2); above 0.675 is <b>high probability of advanced fibrosis</b> (F3–F4, meaning bridging scarring or cirrhosis); in between is <b>indeterminate</b>, where a liver stiffness scan is the usual next step. The scale runs through negative numbers, so −2 is better than −1. Read it with FIB-4: when both are low the reassurance is strong.",
    moves: "Age, weight (through BMI), a fasting glucose crossing 100 mg/dL, anything that raises AST (alcohol, hard exercise, muscle strain), and a fall in platelets or albumin for any reason.",
    act: "Indeterminate or high, particularly with FIB-4 pointing the same way: ask your clinician whether a liver stiffness scan or referral makes sense.",
    caveat: "It was built for people already known to have fatty liver. Age, BMI and diabetes push it up in older and heavier people even when the liver is fine, so indeterminate results are common.",
  },
  apri: {
    what: "APRI (AST-to-platelet ratio index) compares the liver enzyme AST, taken as a multiple of its upper normal limit, with your platelet count. Scarring tends to raise AST and lower platelets, so both push the index up. It was first developed in people with hepatitis C.",
    read: "Under 0.5 is <b>low probability of significant fibrosis</b>, 0.5 to under 1.5 is <b>indeterminate</b>, and 1.5 or more is <b>high probability of significant fibrosis</b>. A higher cut-off of 2.0 was used to suggest cirrhosis. APRI is simpler and less accurate than FIB-4 for fatty liver, so when you have both, let FIB-4 lead.",
    moves: "Anything that raises AST (alcohol, a hard workout or muscle injury, some medicines, any liver inflammation) or lowers platelets.",
    act: "1.5 or more, or a rising trend, especially with FIB-4 also raised: discuss it with your clinician.",
    caveat: "Pulse assumes an AST upper limit of normal of 40 U/L, as in the original study. If your lab's limit is quite different, the number shifts.",
  },
  // ---------------------------------------------------------------- blood-count inflammation ratios
  nlr: {
    what: "The neutrophil-to-lymphocyte ratio compares two kinds of white blood cell from a standard blood count. Neutrophils rise quickly with infection, injury and stress hormones, while lymphocytes tend to fall under the same strain, so the ratio is a simple reading of how much inflammation or physical stress the body is under.",
    read: "0.78 to 3.53 is <b>within the healthy-adult reference range</b>, the middle 95% of a large group of healthy, non-elderly adults. Above 3.53 is <b>above</b> that range and under 0.78 <b>below</b> it. It is a reference range, not a diagnostic cut-off. In research a persistently high ratio goes with higher heart and overall risk, but one high reading usually just reflects a recent infection, hard exercise or stress. A low ratio often reflects a naturally low neutrophil count, which is common and harmless in many people of African or Middle Eastern ancestry.",
    moves: "Higher: infection, recent surgery or injury, steroid medicines, intense exercise, poor sleep, acute stress, smoking. Lower: anything that lowers neutrophils (some medicines, an inherited low count) or raises lymphocytes.",
    act: "Above the range on repeat counts with no obvious cause, or with fever, weight loss or night sweats: mention it to your clinician.",
    caveat: "A count taken during or just after an illness is not a fair baseline. Absolute counts and percentages give the same ratio, so Pulse uses whichever your report has.",
  },
  sii: {
    what: "The systemic immune-inflammation index folds three parts of a blood count into one inflammation reading: neutrophils and platelets, which tend to rise with inflammation, against lymphocytes, which tend to fall.",
    read: "189 to 1168 is <b>within the general-population reference range</b>, the middle 95% of adults in a large Dutch population study, where the average was about 460. Above 1168 is <b>above</b> the range and under 189 <b>below</b> it. It is a reference range, not a diagnostic cut-off, and it is mainly a research measure, so follow it as a trend.",
    moves: "The same things as the neutrophil-to-lymphocyte ratio, plus anything that changes platelets: iron deficiency and inflammation raise them; some infections and medicines lower them.",
    act: "Persistently above the range with no obvious cause: mention it alongside your full blood count at your next appointment.",
    caveat: "Needs absolute counts, not percentages.",
  },
  plr: {
    what: "Platelets divided by lymphocytes. Platelets tend to rise and lymphocytes to fall with inflammation, so the ratio goes up with it.",
    read: "61 to 239 is <b>within the general-population reference range</b>, from the same Dutch study as SII. Above 239 is <b>above</b> the range and under 61 <b>below</b> it. It is a reference range, not a diagnostic cut-off, and of the three blood-count ratios it is the least established, so read it as context beside the neutrophil-to-lymphocyte ratio.",
    moves: "Higher: inflammation, infection, iron deficiency, recent bleeding. Lower: anything that lowers platelets, or a high lymphocyte count.",
  },
  // ---------------------------------------------------------------- omega-3 fats
  omega3_index: {
    what: "The Omega-3 Index is the share of the fatty acids in your red blood cell membranes made up of EPA and DHA, the long-chain omega-3 fats found mainly in oily fish. Red cells live about four months, so it reflects your intake over the last few months, not your last meal.",
    read: "8% or more is <b>desirable</b>, above 4% to under 8% is <b>intermediate</b>, and 4% or less is <b>undesirable</b>. In the work that proposed it, 8% or more went with the lowest risk of sudden cardiac death and 4% or less with the highest. Many people on a typical Western diet sit in the intermediate range. Some panels report an \"omega-3 total\" that also includes DPA and reads a little higher; the validated index is EPA plus DHA only.",
    moves: "Higher: oily fish (salmon, sardines, mackerel, herring) twice a week or more, or a fish-oil or algae-oil supplement; it takes about three to four months to settle at a new level. Lower: little or no fish. Plant omega-3 (flax, chia, walnuts) raises it only slightly, because the body turns very little of it into EPA and DHA.",
    act: "Intermediate or undesirable: worth asking your clinician whether more oily fish or a supplement suits you, especially if you take a blood thinner or have atrial fibrillation, since high-dose fish oil slightly raised the chance of atrial fibrillation in trials.",
    caveat: "Labs use slightly different methods, so compare results from the same test.",
  },
  aa_epa: {
    what: "Arachidonic acid (AA) is an omega-6 fat that the body turns into signalling molecules that tend to promote inflammation; EPA is an omega-3 fat whose products tend to calm it. This ratio compares the two in your red cell membranes.",
    read: "There is <b>no single validated cut-off</b>, so Pulse does not colour it; <b>lower is generally considered more favourable</b>. In Japanese cohorts, people with more EPA relative to AA (the mirror image of this ratio) had fewer heart events. Read it as a direction beside the Omega-3 Index, not on its own.",
    moves: "Lower: more oily fish or fish oil. The body keeps AA fairly steady, so most of the change in this ratio comes from EPA going up or down.",
    caveat: "Some labs report EPA/AA instead, which runs the other way; check which way round a number is before comparing.",
  },
  // ---------------------------------------------------------------- hormones
  fai: {
    what: "The free androgen index estimates how much testosterone is free to act, by comparing total testosterone with SHBG (sex hormone-binding globulin), the protein that holds most testosterone in the blood and keeps it inactive.",
    read: "There is no single healthy range: <b>reference ranges vary a lot between labs</b>, so judge it against your lab's own range if one is printed. It is <b>interpreted mainly in women</b>, where a high index supports a picture of excess male-type hormones, as in polycystic ovary syndrome. It is <b>not a standard marker in men</b>: when SHBG is unusually high or low it misleads, and a calculated or measured free testosterone is preferred.",
    moves: "SHBG rises with age, oestrogen (including the pill and hormone therapy taken by mouth), an overactive thyroid and liver disease, which lowers the index; it falls with excess weight, insulin resistance and an underactive thyroid, which raises it. Testosterone is highest in the morning, so draws are usually done early.",
    act: "In women, a high index with irregular periods, acne or unwanted hair growth is worth discussing. In men, symptoms of low testosterone call for a properly timed morning test, not this ratio.",
    caveat: "A rough proxy. Testosterone tests at the low levels found in women vary between labs.",
  },
  // ---------------------------------------------------------------- fill-ins
  iron_sat_calc: {
    what: "Transferrin saturation is the share of your blood's iron-carrying protein (transferrin) that is actually loaded with iron, worked out from serum iron and the total iron-binding capacity (TIBC). Pulse calculates it because your panel did not report it.",
    read: "Under 15% is <b>low</b> and may suggest iron deficiency; 15–45% is <b>typical</b>; above 45% is <b>high</b>, which should be repeated (ideally fasting, in the morning) and, if it stays high, checked for iron overload such as haemochromatosis. Read it with ferritin, which reflects your iron stores: low saturation with low ferritin points to deficiency, and high saturation with high ferritin to overload.",
    moves: "Serum iron swings through the day and rises for hours after an iron-rich meal or an iron tablet, so the timing of the draw matters a lot. Lower: blood loss (including heavy periods), low iron intake, inflammation. Higher: iron supplements, inherited haemochromatosis, heavy alcohol use, some liver conditions.",
    act: "Under 15% with tiredness, breathlessness or low haemoglobin, or above 45% on a repeat fasting test: see your clinician. Iron deficiency in men or after menopause always needs an explanation, as it can mean hidden bleeding.",
    caveat: "One iron result is noisy. If you take iron, the timing of your last dose affects the result, so mention it when the result is interpreted.",
  },
  bun_creat_calc: {
    what: "Blood urea nitrogen (BUN) and creatinine are both waste products cleared by the kidneys. Comparing them helps tell kidney causes from other causes when either is off: urea also responds to hydration, protein intake and bleeding in the gut, while creatinine mostly reflects muscle and kidney filtering. Pulse calculates the ratio because your panel did not report it.",
    read: "10 to 20 is <b>typical</b>. Above 20 is <b>high</b>: most often mild dehydration or a high-protein diet, sometimes bleeding in the upper gut or heart failure. Below 10 is <b>low</b>: usually a low-protein diet or drinking a lot of fluid, sometimes liver disease. When BUN and creatinine are each within range, the ratio means little on its own.",
    moves: "Higher: not drinking enough, a high-protein diet, steroid medicines, upper-gut bleeding, and low muscle mass (which lowers creatinine). Lower: low protein intake, a lot of fluid, liver disease.",
    act: "A high ratio with black, tarry stools or vomiting blood needs urgent care. Otherwise, a ratio outside 10–20 matters mainly when BUN or creatinine is out of range too.",
  },
  // ---------------------------------------------------------------- biological age
  phenoage: {
    what: "PhenoAge is a \"biological age\" calculated from nine routine blood results plus your actual age: albumin, creatinine, glucose, CRP, lymphocyte percentage, red-cell size (MCV), variation in red-cell size (RDW), alkaline phosphatase and white cell count. Morgan Levine and colleagues weighted these markers by how well they predicted death in a large US health survey (NHANES), then expressed the result as the age at which an average person carries that level of risk.",
    read: "The headline is the gap from your real age. <b>Younger</b> means your markers look like those of a younger, lower-risk person; <b>older</b> means higher risk than average for your age. In the original cohort each year of this \"acceleration\" went with about 9% higher mortality, so a gap of a year or so is small, and a gap of several years is worth understanding. Because a single panel is noisy, the trend across your annual panels matters far more than any one result.",
    moves: "Each of the nine markers pulls it. A cold or infection raises CRP and white cells and lowers lymphocytes; a high glucose that day (not fasting, poor sleep, stress) pushes it up; heavy drinking enlarges red cells; low iron, B12 or folate change red-cell size and its variation. Lasting improvement comes from the usual places: fitness, a healthy weight, good blood-sugar control, not smoking and little or no alcohol.",
    act: "It is not a diagnosis. If it is well above your age, look at which inputs drive it; a high glucose, CRP or RDW is worth discussing on its own merits.",
    caveat: "Retest when you are well and fasting before reading much into a jump. It was built in one population at one time, other blood-age formulas give different numbers, and lowering it has not been shown to lengthen life.",
  },
  // ---------------------------------------------------------------- heart risk
  prevent: {
    what: "The American Heart Association's PREVENT equations (2024) estimate your chance over the next 10 and 30 years of a heart attack or stroke (<b>ASCVD</b>), of any cardiovascular event including heart failure (<b>total CVD</b>), and of <b>heart failure</b> alone. They use age, sex, total and HDL cholesterol, systolic blood pressure and whether it is treated, diabetes, smoking, kidney function (eGFR), statin use and, for heart failure, BMI, with HbA1c added when you have one. They are for adults aged 30–79 who do not already have heart or artery disease.",
    read: "For 10-year heart attack and stroke risk, the 2026 ACC/AHA guideline uses four categories: under 3% is <b>low</b>, 3% to under 5% <b>borderline</b>, 5% to under 10% <b>intermediate</b>, and 10% or more <b>high</b>. A 10% risk means that of 100 people with your numbers, about 10 would have a heart attack or stroke in the next ten years. The 30-year figures matter most for younger adults, whose 10-year risk is low largely because of age. It is a population estimate: what happens on average to people like you, not a forecast for you.",
    moves: "The parts you can change: systolic blood pressure, cholesterol (non-HDL and HDL), smoking, diabetes and blood-sugar control, and kidney function; BMI feeds only the heart-failure estimate, not the heart attack and stroke one. Age always pushes it up. Blood-pressure treatment and statins are inputs too, so a number on treatment is not directly comparable with one before it.",
    act: "The guideline uses this number to start a conversation about statins, not to decide alone. Especially in the borderline and intermediate categories, risk-enhancing factors such as a raised Lp(a), persistently high triglycerides or CRP, early heart disease in the family, chronic kidney disease or metabolic syndrome can tip the balance toward treatment, and a coronary calcium scan can help when it is still unclear. Bring the number and the list of risk enhancers to your clinician.",
    caveat: "It does not apply after a heart attack, stroke or other diagnosed artery disease; people who have had one are treated as high risk already. PREVENT gives lower numbers than the older Pooled Cohort Equations for many people, so a result can drop when the calculator changes without anything changing in you. The 30-year estimates were developed for ages 30–59.",
  },
  // ---------------------------------------------------------------- body measurements
  whtr: {
    what: "Your waist divided by your height. It is a simple measure of fat carried around the middle, the kind packed around the organs that is most closely linked to type 2 diabetes, high blood pressure and heart disease.",
    read: "Under 0.5 is <b>no increased risk</b>, 0.5 to under 0.6 is <b>increased health risk</b>, and 0.6 or more is <b>high health risk</b> (NICE bands). The message fits on a tape: keep your waist to less than half your height. The same 0.5 line worked across sexes and ethnic groups in a large review, and waist-to-height predicted heart and metabolic risk better than BMI.",
    moves: "Losing fat around the middle lowers it: exercise, less alcohol and fewer refined carbohydrates. Regular exercise can shrink the waist even when the scale barely moves. How and where you measure moves it too.",
    act: "0.6 or more, or 0.5 or more with high blood pressure, raised glucose or high triglycerides: worth discussing at your next check-up.",
    caveat: "Measure midway between your lowest rib and the top of your hip bone, after breathing out normally, with the tape level and snug but not tight. A tape a couple of centimetres higher or lower changes the ratio more than a month of real change would.",
  },
  rfm: {
    what: "Relative fat mass estimates your body-fat percentage from your height and waist, with an adjustment for sex because women carry more body fat at the same shape. It was developed against body-composition (DXA) scans in a large US health survey, and there it estimated body fat more accurately than BMI.",
    read: "Pulse shows it as an <b>estimated body-fat percentage</b> without coloured zones. Healthy body-fat ranges rise with age and are higher for women than for men, and no single set of cut-offs is firmly validated for this formula. Its value is in your own trend over months.",
    moves: "Your waist: anything that trims fat around the middle lowers it. Your height does not change, so it tracks your waist directly.",
    caveat: "An estimate, not a scan. It is less thrown by heavy muscle than BMI, but tape placement changes it more than a month of real change would, so measure the same way each time.",
  },
  bmi: {
    what: "Body mass index is your weight scaled for your height, so people of different heights can be compared. It is what most guidelines and risk calculators use, including PREVENT for heart failure.",
    read: "WHO adult bands: under 18.5 is <b>underweight</b>, 18.5 to under 25 <b>healthy weight</b>, 25 to under 30 <b>overweight</b>, and 30 or more <b>obesity</b>. Risk rises gradually across the bands rather than jumping at a line. In people of Asian ancestry health risks start at lower BMIs, and lower action points (23 and 27.5) are often used. In older adults the lowest risk sits somewhat higher, and being underweight is often the bigger concern.",
    moves: "Weight change. Losing height with age nudges it up slightly.",
    act: "30 or more, or 25 or more with a waist over half your height, high blood pressure, raised glucose or high cholesterol: worth a conversation about weight and heart risk. Weight loss you cannot explain also deserves a check.",
    caveat: "BMI cannot tell muscle from fat: muscular people can read overweight while lean, and older adults can have a normal BMI with little muscle and a lot of fat. It also says nothing about where fat sits; the waist-to-height ratio adds that, and fat around the middle carries the most risk.",
  },
};
