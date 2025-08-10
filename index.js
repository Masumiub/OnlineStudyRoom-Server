const express = require('express')
require('dotenv').config()
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const port = process.env.PORT || 3000
const app = express()
var admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf-8')

var serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



app.use(cors({
    origin: ['http://localhost:5173', 'https://onlinestudyroom-all.web.app'],
    credentials: true,
}))
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.upsc470.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const verifyJWT = async (req, res, next) => {
    const token = req?.headers?.authorization?.split(' ')[1]
    //console.log(token);

    if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.tokenEmail = decoded.email
        //console.log(decoded)
        next()
    } catch (err) {
        //console.log(err)
        return res.status(401).send({ message: 'Unauthorized Access!' })
    }
}


async function run() {
    try {
        const database = client.db('OnlineStudyRoomDB')
        const assignmentCollection = database.collection('assignments')
        const submissionCollection = database.collection('submissions')

        app.get('/latestAssignments', async (req, res) => {
            try {
                const limit = parseInt(req.query.limit) || 0;
                const sortByPostedAt = req.query.sort === 'postedAt';

                let cursor = assignmentCollection.find({});

                if (sortByPostedAt) {
                    cursor = cursor.sort({ postedAt: 1 });
                }

                if (limit > 0) {
                    cursor = cursor.limit(limit);
                }

                const latestAssignments = await cursor.toArray();
                res.send(latestAssignments);
            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch tasks', error });
            }
        })

        app.get('/assignments', async (req, res) => {
            const allAssignments = await assignmentCollection.find().toArray();
            res.send(allAssignments);
        })


        app.post('/create-assignment', verifyJWT, async (req, res) => {
            const assignmentData = req.body;
            const result = await assignmentCollection.insertOne(assignmentData);
            res.send(result);
        })

        app.put('/update-assignment/:id', verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const options = { upsert: true };

                const updatedAssignment = req.body;
                const updatedDoc = {
                    $set: updatedAssignment
                }

                const result = await assignmentCollection.updateOne(query, updatedDoc, options);
                res.send(result);
            }
            catch (error) {
                console.error(error);
                res.status(500).json({ message: 'Update Failed', error: error.message });
            }
        })

        app.delete('/assignments/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await assignmentCollection.deleteOne(query);
            res.send(result);
        })


        //handle assignment submission
        app.post('/submissions/:assignmentId', async (req, res) => {
            const id = req.params.assignmentId;
            const submissionData = req.body;
            const result = await submissionCollection.insertOne(submissionData);
            res.send(result);
        })


        app.get('/assignments/level/:level', async (req, res) => {
            const level = req.params.level;

            if (level === "All") {
                const allAssignments = await assignmentCollection.find().toArray();
                return res.send(allAssignments);
            }

            const query = { level: level };
            const filteredAssignments = await assignmentCollection.find(query).toArray();
            res.send(filteredAssignments);

        })

        app.get('/assignments/search', async (req, res) => {
            const queryText = req.query.query || "";

            const searchRegex = new RegExp(queryText, "i"); 
            const query = { title: { $regex: searchRegex } };

            try {
                const results = await assignmentCollection.find(query).toArray();
                res.send(results);
            } catch (error) {
                res.status(500).json({ message: 'Search failed', error: error.message });
            }
        });


        //get all assignment submission by a user
        app.get('/my-attempts/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const tokenEmail = req.tokenEmail;

            if (email !== tokenEmail) {
                return res.status(403).send({ message: 'Forbidden Access!' });
            }

            const filter = { userEmail: email }
            const allSubmissions = await submissionCollection.find(filter).toArray();

            for (const submission of allSubmissions) {
                const submissionId = submission.assignmentId;
                const fullAssignmentData = await assignmentCollection.findOne(
                    {
                        _id: new ObjectId(submissionId)
                    }
                )
                submission.title = fullAssignmentData.title;
                submission.marks = fullAssignmentData.marks;
            }

            res.send(allSubmissions)
        })


        app.get('/pendings/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const tokenEmail = req.tokenEmail;

            if (email !== tokenEmail) {
                return res.status(403).send({ message: 'Forbidden Access!' });
            }

            const allPendings = await submissionCollection.find({
                userEmail: { $ne: email },
                status: { $ne: "Completed" }
            }).toArray();

            for (const pending of allPendings) {
                const pendingId = pending.assignmentId;
                const fullAssignmentData = await assignmentCollection.findOne({
                    _id: new ObjectId(pendingId)
                });
                pending.title = fullAssignmentData?.title;
                pending.marks = fullAssignmentData?.marks;
            }

            res.send(allPendings);
        });


        app.get('/assignments/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await assignmentCollection.findOne(query);
            res.send(result);
        })


        app.put('/update-mark/:id', verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const options = { upsert: true };

                const updatedSubmission = req.body;
                const updatedDoc = {
                    $set: updatedSubmission
                }

                const result = await submissionCollection.updateOne(query, updatedDoc, options);
                res.send(result);
            }
            catch (error) {
                console.error(error);
                res.status(500).json({ message: 'Update Failed', error: error.message });
            }
        })

        await client.connect();
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        //await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Welcome to OnlineStudyRoomDB Server')
})

app.listen(port, () => {
    console.log(`server running at port ${port}`)
})