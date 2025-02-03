// import db from './database';

// export function getDailyTasks(userId: number, callback: (tasks: any[]) => void) {
//     db.all(`SELECT * FROM tasks WHERE user_id = ? AND completed = 0 LIMIT 5`, [userId], (err, rows) => {
//         if (err) {
//             console.error(err);
//             callback([]);
//         } else {
//             callback(rows);
//         }
//     });
// }

// export function completeTask(taskId: number, callback: (success: boolean) => void) {
//     db.run(`UPDATE tasks SET completed = 1 WHERE id = ?`, [taskId], function (err) {
//         if (err) {
//             console.error(err);
//             callback(false);
//         } else {
//             db.run(`UPDATE users SET points = points + 10 WHERE id = (SELECT user_id FROM tasks WHERE id = ?)`, [taskId], (err) => {
//                 if (err) {
//                     console.error(err);
//                     callback(false);
//                 } else {
//                     callback(true);
//                 }
//             });
//         }
//     });
// } 