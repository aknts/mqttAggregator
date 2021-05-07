module.exports = {
	connectDB: function (sqlite3,sqliteDB) {
		db = new sqlite3.cached.Database(sqliteDB, (err) => {
			if (err) {
				console.log(err.message);
			}
			console.log('Connected to the database.');
		});
		return(db);
	},
	closeDB: function () {
		db.close((err) => {
			if (err) {
				return console.log(err.message);
			}
		console.log('Close the database connection.');
		});
	}
};