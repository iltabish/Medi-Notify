require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { OAuth2Client } = require("google-auth-library");
const mysql=require("mysql2");
const cron = require("node-cron");
const twilio = require("twilio");
const nodemailer = require('nodemailer');

// Twilio Credentials
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;





const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});
db.connect((err) => {
  if (err) throw err;
  console.log("Connected to Clever Cloud MySQL!");

  // Create `users` table
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      phone_number VARCHAR(15)
    )
  `;

  // Create `medicines` table
  const createMedicinesTable = `
    CREATE TABLE IF NOT EXISTS medicines (
      id INT NOT NULL AUTO_INCREMENT,
      email VARCHAR(255) NOT NULL,
      medicineName VARCHAR(255) DEFAULT NULL,
      dosage VARCHAR(255) DEFAULT NULL,
      exactTime VARCHAR(255) DEFAULT NULL,
      startDay VARCHAR(255) DEFAULT NULL,
      endDay VARCHAR(255) DEFAULT NULL,
      PRIMARY KEY (id)
    )
  `;

  // Execute both queries
  db.query(createUsersTable, (err, result) => {
    if (err) throw err;
    console.log("'users' table created or already exists.");

    db.query(createMedicinesTable, (err, result) => {
      if (err) throw err;
      console.log("'medicines' table created or already exists.");
    });
  });
});







const app = express();
const PORT = process.env.PORT || 3000;
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Allowed origins (front-end URLs)
const allowedOrigins = ['http://127.0.0.1:5500', 'http://localhost:3000' , 'https://snazzy-moxie-5d7d91.netlify.app/'];

app.use(
  cors({
    origin: function (origin, callback) {
      if (allowedOrigins.includes(origin) || !origin) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);
app.use(express.json());


function getDay(weekday) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days.indexOf(weekday);
}


function isDayInRange(currentDayNum, startDayNum, endDayNum) {
  if (startDayNum <= endDayNum) {
      return currentDayNum >= startDayNum && currentDayNum <= endDayNum;
  } else {
      return currentDayNum >= startDayNum || currentDayNum <= endDayNum;
  }
}


function sendSMS(phoneNumber, name, medicine, dosage) {
  const message = `Hello ${name}, it's time to take your medicine: ${medicine}. Dosage: ${dosage}.`;

  twilioClient.messages
      .create({ body: message, from: TWILIO_PHONE_NUMBER, to: phoneNumber })
      .then(() => console.log(`SMS sent : ${message}`))
      .catch(error => console.error("SMS Error:", error));
}





async function sendEmail(name, toEmail, medicine, dosage) {
  console.log("Script started");

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'iltabishkhan30@gmail.com',
      pass: 'kzufqpdkfwdwhjsf'  
    }
  });

  const mailOptions = {
    from: 'iltabishkhan30@gmail.com',
    to: toEmail,
    subject: `Medicine Reminder for ${name}`,
    text: `Hello ${name},\n\nIt's time to take your medicine: ${medicine}.\nDosage: ${dosage}.\n\nTake care! 🙂`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.response);
  } catch (err) {
    console.log('Error:', err);
  }
}


// Cron Job to Check & Send Reminders (Runs Every Minute)
cron.schedule("* * * * *", () => {
  const now = new Date();
  const currentDay = now.toLocaleString("en-US", { weekday: "long", timeZone: "Asia/Kolkata" });
  const currentDayNum = getDay(currentDay);
  const currentTime = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

  console.log(`Checking at: ${currentTime}, Day: ${currentDayNum}`);

  const query = `
      SELECT users.name, users.email,users.phone_number, medicines.medicineName, medicines.dosage, medicines.exactTime, 
             medicines.startDay, medicines.endDay 
      FROM medicines
      JOIN users ON medicines.email = users.email
  `;
  db.query(query, (err, results) => {
      if (err) {
          console.error("Database Query Error:", err);
          return;
      }

      results.forEach(reminder => {
          const startDayNum = getDay(reminder.startDay);
          const endDayNum = getDay(reminder.endDay);
          
          if (isDayInRange(currentDayNum, startDayNum, endDayNum) && reminder.exactTime === currentTime) {
            const cleanedPhoneNumber = reminder.phone_number.replace(/\s+/g, "");
          
            sendSMS(cleanedPhoneNumber, reminder.name, reminder.medicineName, reminder.dosage);
            sendEmail(reminder.name,reminder.email,reminder.medicineName,reminder.dosage);
        }
      });
  });
});



app.post("/verify-token", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    // Verify token with Google OAuth2 client
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const user = {
      email: payload.email,
      name: payload.name
    };

    // Call checkEmail API
    try {
      const response = await fetch('http://localhost:3000/checkEmail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userData: user })
      });

      const data = await response.json();

      if(!data.success){
        return res.json({redirect:"phone-otp.html", user});
      }
      return res.json({user});
      
    } catch (err) {
      return res.status(500).json({ error: "Failed to check email" });
    }

  } catch (error) {
    res.status(401).json({ error: "Invalid Token" });
  }
});


app.post('/checkEmail', (req, res) => {
  const user = req.body.userData;
  if (!user || !user.email) {
    return res.status(400).json({ success: false, message: 'Invalid user data' });
  }

  const query = `SELECT EXISTS (SELECT 1 FROM users WHERE email=?) AS email_exists`;
  db.query(query, [user.email], (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Failed to check data' });
    }

    if (!result[0].email_exists) {
      return res.status(200).json({ success: false});
    } else {
      return res.status(200).json({ success: true});
    }
  });
});

app.post('/saveNewUser',(req,res)=>{
  const user =req.body;
  if (!user || !user.email) {
    return res.status(400).send({ success: false, message: 'Invalid user data' });
  }
   
      const query = `INSERT INTO users (name,email,phone_number) values (?,?,?)`;
      db.query(query,[user.name, user.email,user.phoneNumber],(err)=>{
        if(err){
        return res.status(500).send({success: false,message : 'Failed to insert data'});
        }
        return res.status(200).send({ success: true, message: 'User data saved successfully' });
      });

});


app.post('/save', (req, res) => {
  const { email, medicineName, dosage, time, exactTime, startDay, endDay } = req.body;

  const sql = `INSERT INTO medicines (email, medicineName, dosage, exactTime, startDay, endDay) VALUES (?, ?, ?,  ?, ?, ?)`;

  db.query(sql, [email, medicineName, dosage,  exactTime, startDay, endDay], (err,result) => {
      if (err) {
        console.error("Error saving data:", err.message);
        return res.status(500).send({ success: false, message: 'Failed to save data' });
    }
      res.send({ success: true,id: result.insertId, message: 'Data saved' });
  });
});

  app.get('/get-medicines', (req, res) => {
    const email = req.query.email; 
    const query = `SELECT m.* 
                  FROM medicines m
                  JOIN users u ON m.email = u.email
                   WHERE u.email = ?`;

    db.query(query, [email], (err, results) => {
        if (err) {
            res.status(500).json({ error: "Failed to fetch data" });
            return;
        }
        res.json(results);
    });
});

app.delete('/delete', (req, res) => {
  const { id } = req.body;

  if (!id) {
      return res.status(400).send({ success: false, message: 'Missing id' });
  }

  const sql = `DELETE FROM medicines WHERE id = ?`;

  db.query(sql, [id], (err, result) => {
      if (err) {
          return res.status(500).send({ success: false, message: 'Failed to delete data' });
      }

      if (result.affectedRows > 0) {
          res.send({ success: true, message: 'Data deleted successfully' });
      } else {
          res.status(404).send({ success: false, message: 'No matching record found' });
      }
  });
});

app.listen(PORT, () => {
  console.log(`Server running at: http://localhost:${PORT}`);
});
