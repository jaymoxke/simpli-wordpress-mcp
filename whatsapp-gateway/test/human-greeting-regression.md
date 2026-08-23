# Human greeting regression

Incident input: `Hi Simpli`

Forbidden behavior on a greeting-only first message:
- do not offer a menu of skincare tasks;
- do not introduce product names, prices, acne, routines, categories or examples the customer did not mention;
- do not turn the greeting into a sales prompt;
- do not ask multiple-choice questions;
- do not repeat `I’m Simpli` when the customer has already addressed the assistant as Simpli.

Expected behavior:
- if the customer has not used the assistant name yet, introduce as Simpli once on the first reply;
- if the customer already says `Simpli`, acknowledge naturally without reintroducing;
- respond socially and briefly to greeting-only openings;
- let the customer lead the next turn.

Canonical acceptable shapes:
- `Hi` -> `Hi 😊 I’m Simpli. How are you?`
- `Hi Simpli` -> `Hi 😊 How are you?`
- `Good morning Simpli` -> `Good morning 😊 How are you?`

For a real first-turn question that already addresses Simpli by name, preserve the actual answer and remove only a redundant self-introduction.
